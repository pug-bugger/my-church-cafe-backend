const express = require("express");
const { getPool, withTransaction } = require("../config/db");
const { authMiddleware, requireRole } = require("../middleware/auth");
const { buildKitchenTicket } = require("../lib/escpos");
const { asyncHandler } = require("../utils/asyncHandler");
const { emitOrderEvent } = require("../utils/orderEvents");

const router = express.Router();

// Public "active orders" board for an organization — no login required.
// Returns orders that are still in flight (not yet completed or cancelled).
router.get("/public", async (req, res, next) => {
  try {
    const organizationName =
      typeof req.query.organization === "string"
        ? req.query.organization.trim()
        : "";
    if (!organizationName) {
      return res
        .status(400)
        .json({ error: "organization query parameter is required" });
    }

    const pool = getPool();
    const [orgRows] = await pool.query(
      "SELECT id FROM organizations WHERE name = ? LIMIT 1",
      [organizationName],
    );
    if (!orgRows.length) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const [orders] = await pool.query(
      `SELECT o.*, ${orderNumberSubquery}
       FROM orders o
       WHERE o.organization_id = ?
         AND o.status IN ('pending', 'preparing', 'ready')
       ORDER BY o.created_at DESC`,
      [orgRows[0].id],
    );
    const withItems = await attachOrderItems(pool, orders);
    return res.json(withItems);
  } catch (err) {
    return next(err);
  }
});

router.use(authMiddleware);

let cachedOrderItemProductColumn = null;

const getOrderItemProductColumn = async (pool) => {
  if (cachedOrderItemProductColumn) return cachedOrderItemProductColumn;
  const [cols] = await pool.query(
    "SHOW COLUMNS FROM order_items LIKE 'product_id'",
  );
  cachedOrderItemProductColumn = cols.length ? "product_id" : "product_item_id";
  return cachedOrderItemProductColumn;
};

/** Attach product_item_options[] to each order item (for barista UI). */
async function enrichItemsWithOptions(pool, items) {
  if (!items.length) return;
  const itemIds = items.map((row) => row.id);
  let opts = [];
  const withPrice = await hasOptionPriceColumn(pool);
  try {
    const [rows] = await pool.query(
      `SELECT id, order_item_id, option_definition_name, option_value_name
              ${withPrice ? ", extra_price" : ""}
       FROM order_item_options
       WHERE order_item_id IN (?)
       ORDER BY id ASC`,
      [itemIds],
    );
    opts = rows;
  } catch (err) {
    if (err && err.code === "ER_NO_SUCH_TABLE") {
      for (const item of items) {
        item.product_item_options = [];
      }
      return;
    }
    throw err;
  }
  const byItem = new Map();
  for (const o of opts) {
    if (!byItem.has(o.order_item_id)) byItem.set(o.order_item_id, []);
    byItem.get(o.order_item_id).push({
      id: o.id,
      option_definition_name: o.option_definition_name,
      option_value_name: o.option_value_name,
      // What this option added to the line when the order was placed — not what
      // it would cost today.
      extra_price: Number(o.extra_price ?? 0),
    });
  }
  for (const item of items) {
    item.product_item_options = byItem.get(item.id) || [];
  }
}

/**
 * Attach checkbox_options[] — every checkbox the item's product offers — so the
 * kitchen ticket can print a Yes/No line for each. An unticked box is never
 * written to order_item_options (see insertOrderItemOptions), so the stored
 * options alone can't tell "No" apart from "not offered on this drink".
 * Print-path only; the barista UI keeps showing just the selected options.
 */
async function attachCheckboxDefinitions(pool, items) {
  if (!items?.length) return;
  const productIds = [
    ...new Set(items.map((item) => item.product_id).filter(Boolean)),
  ];
  if (!productIds.length) return;
  let rows = [];
  try {
    const [found] = await pool.query(
      `SELECT pdo.product_id, d.name
         FROM product_drink_options pdo
         JOIN drink_option_definitions d ON d.id = pdo.option_definition_id
        WHERE pdo.product_id IN (?) AND d.type = 'checkbox'
        ORDER BY pdo.sort_order ASC, d.sort_order ASC, d.id ASC`,
      [productIds],
    );
    rows = found;
  } catch (err) {
    if (err && err.code === "ER_NO_SUCH_TABLE") return;
    throw err;
  }
  const byProduct = new Map();
  for (const row of rows) {
    if (!byProduct.has(row.product_id)) byProduct.set(row.product_id, []);
    byProduct.get(row.product_id).push({ name: row.name });
  }
  for (const item of items) {
    item.checkbox_options = byProduct.get(item.product_id) || [];
  }
}

let cachedOptionPriceColumn = null;

/**
 * Whether `order_item_options.extra_price` exists yet.
 *
 * The backend redeploys automatically on a push to `prod` while migrations are
 * run by hand, so a deploy can land before `migration_order_item_option_price`
 * does. Without this check that window would 500 on every order. Same runtime
 * detection the `product_id` rename uses above.
 */
const hasOptionPriceColumn = async (conn) => {
  if (cachedOptionPriceColumn !== null) return cachedOptionPriceColumn;
  try {
    const [cols] = await conn.query(
      "SHOW COLUMNS FROM order_item_options LIKE 'extra_price'",
    );
    cachedOptionPriceColumn = cols.length > 0;
  } catch (err) {
    if (err && err.code === "ER_NO_SUCH_TABLE") {
      cachedOptionPriceColumn = false;
    } else {
      throw err;
    }
  }
  return cachedOptionPriceColumn;
};

const normalizeLabel = (value) => String(value).trim().toLowerCase();

/**
 * Resolve every item's selected options into priced rows, reading each price
 * from the database.
 *
 * The client sends only *which* option was picked, never what it costs, so this
 * is the only place an order's surcharges are decided. Sets two fields on each
 * normalized item: `optionRows` (ready to INSERT) and `surcharge` (the per-unit
 * sum to add to the line price).
 *
 * A selection that matches no value row prices at 0 and is still recorded — a
 * stale client must never be able to fail order taking.
 */
async function attachOptionPricing(conn, normalizedItems) {
  for (const item of normalizedItems) {
    item.optionRows = [];
    item.surcharge = 0;
  }

  const entriesByItem = normalizedItems.map((item) => {
    const selected = item.selectedOptions;
    if (!selected || typeof selected !== "object" || Array.isArray(selected)) {
      return [];
    }
    return Object.entries(selected).filter(
      ([, v]) => v != null && String(v).length > 0,
    );
  });

  const defIds = [
    ...new Set(
      entriesByItem
        .flat()
        .map(([k]) => Number.parseInt(String(k), 10))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ];
  if (!defIds.length) return;

  let defs = [];
  let values = [];
  try {
    const [defRows] = await conn.query(
      `SELECT id, name, type, checkbox_extra_price
         FROM drink_option_definitions WHERE id IN (?)`,
      [defIds],
    );
    defs = defRows;
    const [valueRows] = await conn.query(
      `SELECT option_definition_id, label, extra_price
         FROM drink_option_values
        WHERE option_definition_id IN (?)
        ORDER BY sort_order ASC, id ASC`,
      [defIds],
    );
    values = valueRows;
  } catch (err) {
    // No options tables on this install: everything stays at 0.
    if (err && err.code === "ER_NO_SUCH_TABLE") return;
    throw err;
  }

  const defById = new Map(defs.map((d) => [d.id, d]));
  // Selections arrive as labels rather than value ids, so price lookup is by
  // label. `ORDER BY sort_order, id` above makes a duplicate label deterministic
  // — first one wins — rather than whichever row the engine happened to return.
  const priceByDefAndLabel = new Map();
  for (const v of values) {
    const key = `${v.option_definition_id}:${normalizeLabel(v.label)}`;
    if (!priceByDefAndLabel.has(key)) {
      priceByDefAndLabel.set(key, Number(v.extra_price ?? 0));
    }
  }

  normalizedItems.forEach((item, index) => {
    for (const [defIdStr, rawVal] of entriesByItem[index]) {
      const defId = Number.parseInt(String(defIdStr), 10);
      if (!Number.isFinite(defId) || defId <= 0) continue;
      const def = defById.get(defId);
      if (!def) continue;
      const val = String(rawVal);

      if (def.type === "checkbox") {
        // An unticked box is not recorded at all, so "no row" reads as No.
        if (val !== "true") continue;
        const price = Number(def.checkbox_extra_price ?? 0);
        item.optionRows.push([defId, def.name, "Yes", price]);
        item.surcharge += price;
      } else {
        const price =
          priceByDefAndLabel.get(`${defId}:${normalizeLabel(val)}`) ?? 0;
        item.optionRows.push([defId, def.name, val, price]);
        item.surcharge += price;
      }
    }
  });
}

async function persistOptionsForNewOrder(conn, newOrderId, normalizedItems) {
  const withPrice = await hasOptionPriceColumn(conn);
  const [orderItemRows] = await conn.query(
    "SELECT id FROM order_items WHERE order_id = ? ORDER BY id ASC",
    [newOrderId],
  );
  const rows = [];
  for (let i = 0; i < normalizedItems.length; i += 1) {
    const row = orderItemRows[i];
    if (!row) break;
    for (const [defId, defName, valueName, price] of
      normalizedItems[i].optionRows ?? []) {
      rows.push(
        withPrice
          ? [row.id, defId, defName, valueName, price]
          : [row.id, defId, defName, valueName],
      );
    }
  }
  if (!rows.length) return;
  const columns = withPrice
    ? "(order_item_id, drink_option_definition_id, option_definition_name, option_value_name, extra_price)"
    : "(order_item_id, drink_option_definition_id, option_definition_name, option_value_name)";
  try {
    await conn.query(
      `INSERT INTO order_item_options ${columns} VALUES ?`,
      [rows],
    );
  } catch (err) {
    if (err && err.code === "ER_NO_SUCH_TABLE") return;
    throw err;
  }
}

const attachOrderItems = async (pool, orders) => {
  if (!orders.length) return orders;
  const orderIds = orders.map((order) => order.id);
  const [items] = await pool.query(
    `SELECT oi.id, oi.order_id, oi.product_id, oi.quantity, oi.price, oi.comment,
                  p.name AS product_item_name,
                  COALESCE(parent_cat.name, cat.name) AS category_name
           FROM order_items oi
           LEFT JOIN products p ON oi.product_id = p.id
           LEFT JOIN categories cat ON p.category_id = cat.id
           LEFT JOIN categories parent_cat ON cat.parent_id = parent_cat.id
           WHERE oi.order_id IN (?)`,
    [orderIds],
  );
  await enrichItemsWithOptions(pool, items);
  const itemsByOrder = new Map();
  for (const item of items) {
    if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
    itemsByOrder.get(item.order_id).push(item);
  }
  return orders.map((order) => ({
    ...order,
    items: itemsByOrder.get(order.id) || [],
  }));
};

// Create order from items: [{ quantity, product: { id } }]
router.post("/", async (req, res, next) => {
  try {
    const orderPayload = req.body?.order ?? req.body ?? {};
    const items = orderPayload.order_items ?? orderPayload.items ?? [];

    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ error: "order without items is not allowed" });
    }

    const orderComment = typeof orderPayload.comment === "string" ? orderPayload.comment.trim() : null;
    const customerName = typeof orderPayload.customer_name === "string" ? orderPayload.customer_name.trim() || null : null;

    const created = await withTransaction(async (conn) => {
      const productColumn = await getOrderItemProductColumn(conn);

      const normalizedItems = items.map((item) => {
        const quantity = Math.max(1, Number(item.quantity || 1));
        const productId =
          item.product_id ??
          item.productId ??
          item.product?.id ??
          (typeof item.product === "number" ? item.product : null);
        const rawOpts =
          item.selectedOptions ?? item.selected_options ?? item.options ?? {};
        const selectedOptions =
          rawOpts &&
          typeof rawOpts === "object" &&
          !Array.isArray(rawOpts)
            ? rawOpts
            : {};
        const comment = typeof item.comment === "string" ? item.comment.trim() : null;
        return {
          quantity,
          productId,
          selectedOptions,
          comment: comment || null,
        };
      });

      // Price the options before any money is worked out: the surcharges are
      // part of the line rate, not something added afterwards.
      await attachOptionPricing(conn, normalizedItems);

      if (productColumn === "product_id") {
        const productIds = normalizedItems
          .map((it) => it.productId)
          .filter((id) => Number.isFinite(Number(id)));
        if (productIds.length !== normalizedItems.length) {
          throw Object.assign(new Error("Invalid product"), { status: 400 });
        }
        const [productRows] = await conn.query(
          "SELECT id, base_price FROM products WHERE id IN (?)",
          [productIds],
        );

        const basePriceById = new Map(
          productRows.map((row) => [row.id, Number(row.base_price || 0)]),
        );
        // Calculate total. `order_items.price` is the *unit* rate including the
        // surcharges chosen for that line, which is what keeps the recalculation
        // on item removal (below) and the reports' unit/line columns correct.
        let total = 0;
        for (const it of normalizedItems) {
          const basePrice = basePriceById.get(it.productId);
          if (basePrice === undefined) {
            throw Object.assign(new Error("Invalid product"), { status: 400 });
          }
          it.unitPrice = basePrice + (it.surcharge ?? 0);
          total += it.unitPrice * it.quantity;
        }

        const [orderRes] = await conn.query(
          "INSERT INTO orders (user_id, organization_id, total, status, comment, customer_name) VALUES (?, ?, ?, ?, ?, ?)",
          [req.user.id, req.user.organization_id ?? null, total, "pending", orderComment, customerName],
        );

        const newOrderId = orderRes.insertId;

        const orderItemValues = normalizedItems.map((it) => [
          newOrderId,
          it.productId,
          it.quantity,
          it.unitPrice,
          it.comment,
        ]);
        await conn.query(
          "INSERT INTO order_items (order_id, product_id, quantity, price, comment) VALUES ?",
          [orderItemValues],
        );

        await persistOptionsForNewOrder(conn, newOrderId, normalizedItems);

        return { id: newOrderId, total };
      }

      const candidateItemIds = normalizedItems.map(() => []);
      const missingProductIds = normalizedItems
        .filter(
          (_it, idx) =>
            !Number.isFinite(Number(candidateItemIds[idx])) &&
            Number.isFinite(Number(normalizedItems[idx].productId)),
        )
        .map((it) => it.productId);
      const fallbackByProductId = new Map();
      if (missingProductIds.length) {
        const [fallbackRows] = await conn.query(
          "SELECT id, product_id, base_price FROM products WHERE product_id IN (?) ORDER BY id ASC",
          [missingProductIds],
        );
        for (const row of fallbackRows) {
          if (!fallbackByProductId.has(row.product_id)) {
            fallbackByProductId.set(row.product_id, {
              id: row.id,
              price: Number(row.base_price || 0),
            });
          }
        }
      }
      const finalItemIds = candidateItemIds.map((id, idx) => {
        if (Number.isFinite(Number(id))) return Number(id);
        const productId = normalizedItems[idx].productId;
        const fallback = fallbackByProductId.get(productId);
        return fallback?.id ?? null;
      });

      if (finalItemIds.some((id) => !Number.isFinite(Number(id)))) {
        throw Object.assign(new Error("Invalid product_id"), {
          status: 400,
        });
      }

      const [rows] = await conn.query(
        "SELECT id, base_price FROM products WHERE id IN (?)",
        [finalItemIds],
      );
      const basePriceById = new Map(
        rows.map((r) => [r.id, Number(r.base_price || 0)]),
      );

      // Calculate total — unit rate including this line's surcharges, as above.
      let total = 0;
      for (let i = 0; i < normalizedItems.length; i += 1) {
        const it = normalizedItems[i];
        const primaryId = finalItemIds[i];
        const basePrice = basePriceById.get(primaryId);
        if (basePrice === undefined) {
          throw Object.assign(new Error("Price not found for product_id"), {
            status: 400,
          });
        }
        it.unitPrice = basePrice + (it.surcharge ?? 0);
        total += it.unitPrice * it.quantity;
      }

      const [orderRes] = await conn.query(
        "INSERT INTO orders (user_id, organization_id, total, status, comment, customer_name) VALUES (?, ?, ?, ?, ?, ?)",
        [req.user.id, req.user.organization_id ?? null, total, "pending", orderComment, customerName],
      );
      const newOrderId = orderRes.insertId;

      const orderItemValues = normalizedItems.map((it, idx) => {
        const primaryId = finalItemIds[idx];
        return [newOrderId, primaryId, it.quantity, it.unitPrice, it.comment];
      });
      await conn.query(
        "INSERT INTO order_items (order_id, product_item_id, quantity, price, comment) VALUES ?",
        [orderItemValues],
      );

      await persistOptionsForNewOrder(conn, newOrderId, normalizedItems);

      return { id: newOrderId, total };
    });

    // Realtime event
    const io = req.app.get("io");
    emitOrderEvent(io, req.user.id, "order:created", {
      id: created.id,
      userId: req.user.id,
      total: created.total,
      status: "pending",
    });

    // Best-effort kitchen ticket print — must never fail order creation.
    try {
      const pool = getPool();
      const [orderRows] = await pool.query("SELECT * FROM orders WHERE id = ?", [
        created.id,
      ]);
      const [orderWithItems] = await attachOrderItems(pool, orderRows);
      if (orderWithItems) {
        await attachCheckboxDefinitions(pool, orderWithItems.items);
        const printerClient = req.app.get("printerClient");
        const ticket = buildKitchenTicket(orderWithItems, orderWithItems.items);
        const sent = await printerClient?.print(ticket);
        if (!sent) {
          io?.to("staff").emit("printer:unavailable", { orderId: created.id });
        }
      }
    } catch (printErr) {
      console.error("Kitchen ticket print failed:", printErr);
      io?.to("staff").emit("printer:unavailable", { orderId: created.id });
    }

    return res.status(201).json({ id: created.id });
  } catch (err) {
    return next(err);
  }
});

// Order number: 1-based index per calendar day (resets each day)
const orderNumberSubquery = `(SELECT COUNT(*) FROM orders o2
  WHERE DATE(o2.created_at) = DATE(o.created_at)
    AND (o2.created_at < o.created_at OR (o2.created_at = o.created_at AND o2.id <= o.id))
) AS order_number`;

// Get my orders
router.get("/me", async (req, res, next) => {
  try {
    const pool = getPool();
    const [orders] = await pool.query(
      `SELECT o.*, ${orderNumberSubquery}
       FROM orders o
       WHERE o.user_id = ?
       ORDER BY o.created_at DESC`,
      [req.user.id],
    );
    const withItems = await attachOrderItems(pool, orders);
    return res.json(withItems);
  } catch (err) {
    return next(err);
  }
});

// Get order by id (own or admin)
router.get("/:id", async (req, res, next) => {
  try {
    const pool = getPool();
    const [orders] = await pool.query(
      `SELECT o.*, ${orderNumberSubquery} FROM orders o WHERE o.id = ?`,
      [req.params.id],
    );
    if (!orders.length) return res.status(404).json({ error: "Not found" });
    const order = orders[0];
    if (
      order.user_id !== req.user.id &&
      req.user.role !== "admin" &&
      req.user.role !== "personal"
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const productColumn = await getOrderItemProductColumn(pool);
    const [items] =
      productColumn === "product_id"
        ? await pool.query(
            `SELECT oi.id, oi.order_id, oi.quantity, oi.price, oi.comment, p.name AS product_item_name,
                    COALESCE(parent_cat.name, cat.name) AS category_name
             FROM order_items oi LEFT JOIN products p ON oi.product_id = p.id
             LEFT JOIN categories cat ON p.category_id = cat.id
             LEFT JOIN categories parent_cat ON cat.parent_id = parent_cat.id
             WHERE oi.order_id = ?`,
            [order.id],
          )
        : await pool.query(
            `SELECT oi.id, oi.order_id, oi.quantity, oi.price, oi.comment, pi.name AS product_item_name,
                    NULL AS category_name
             FROM order_items oi LEFT JOIN product_items pi ON oi.product_item_id = pi.id
             WHERE oi.order_id = ?`,
            [order.id],
          );
    await enrichItemsWithOptions(pool, items);
    return res.json({ ...order, items });
  } catch (err) {
    return next(err);
  }
});

// List all orders (any authenticated user; public orders board + barista queue)
router.get("/", async (_req, res, next) => {
  try {
    const pool = getPool();
    const [orders] = await pool.query(
      `SELECT o.*, u.name as user_name, u.email as user_email, ${orderNumberSubquery}
       FROM orders o LEFT JOIN users u ON o.user_id = u.id
       ORDER BY o.created_at DESC`,
    );
    const withItems = await attachOrderItems(pool, orders);
    return res.json(withItems);
  } catch (err) {
    return next(err);
  }
});

// Staff: remove a line item and recalculate order total
router.delete(
  "/:orderId/items/:itemId",
  requireRole("admin", "personal"),
  async (req, res, next) => {
    try {
      const orderId = Number(req.params.orderId);
      const itemId = Number(req.params.itemId);
      if (!Number.isFinite(orderId) || !Number.isFinite(itemId)) {
        return res.status(400).json({ error: "Invalid order or item id" });
      }

      const pool = getPool();
      const [orders] = await pool.query(
        "SELECT id, user_id, status, total FROM orders WHERE id = ?",
        [orderId],
      );
      if (!orders.length) return res.status(404).json({ error: "Order not found" });
      const order = orders[0];

      if (order.status !== "pending") {
        return res
          .status(400)
          .json({ error: "Items can only be removed while order is pending" });
      }

      const [items] = await pool.query(
        "SELECT id FROM order_items WHERE id = ? AND order_id = ?",
        [itemId, orderId],
      );
      if (!items.length) {
        return res.status(404).json({ error: "Item not found" });
      }

      await pool.query("DELETE FROM order_items WHERE id = ?", [itemId]);

      const [remaining] = await pool.query(
        "SELECT quantity, price FROM order_items WHERE order_id = ?",
        [orderId],
      );

      let total = 0;
      for (const row of remaining) {
        total += Number(row.price || 0) * Number(row.quantity || 1);
      }

      const newStatus = remaining.length === 0 ? "cancelled" : order.status;
      await pool.query("UPDATE orders SET total = ?, status = ? WHERE id = ?", [
        total,
        newStatus,
        orderId,
      ]);

      const io = req.app.get("io");
      emitOrderEvent(io, order.user_id, "order:updated", {
        id: orderId,
        userId: Number(order.user_id),
        total,
        status: newStatus,
        removedItemId: itemId,
      });

      return res.json({
        success: true,
        total,
        status: newStatus,
        removed_item_id: itemId,
      });
    } catch (err) {
      return next(err);
    }
  },
);

// Staff: delete entire order (pending only)
router.delete(
  "/:id",
  requireRole("admin", "personal"),
  async (req, res, next) => {
    try {
      const orderId = Number(req.params.id);
      if (!Number.isFinite(orderId)) {
        return res.status(400).json({ error: "Invalid order id" });
      }

      const pool = getPool();
      const [orders] = await pool.query(
        "SELECT id, user_id, status FROM orders WHERE id = ?",
        [orderId],
      );
      if (!orders.length) return res.status(404).json({ error: "Order not found" });
      const order = orders[0];

      if (order.status !== "pending") {
        return res
          .status(400)
          .json({ error: "Only pending orders can be deleted" });
      }

      await pool.query("DELETE FROM orders WHERE id = ?", [orderId]);

      const io = req.app.get("io");
      emitOrderEvent(io, order.user_id, "order:deleted", {
        id: orderId,
        userId: Number(order.user_id),
      });

      return res.status(204).send();
    } catch (err) {
      return next(err);
    }
  },
);

// Admin: update status
router.put(
  "/:id/status",
  requireRole("admin", "personal"),
  async (req, res, next) => {
    try {
      const { status } = req.body;
      const allowed = [
        "pending",
        "preparing",
        "ready",
        "paid",
        "cancelled",
        "completed",
      ];
      if (!allowed.includes(status))
        return res.status(400).json({ error: "Invalid status" });
      const pool = getPool();
      const [orders] = await pool.query(
        "SELECT id, user_id, total, status FROM orders WHERE id = ?",
        [req.params.id],
      );
      if (!orders.length) return res.status(404).json({ error: "Not found" });
      const order = orders[0];
      await pool.query("UPDATE orders SET status = ? WHERE id = ?", [
        status,
        req.params.id,
      ]);

      // Realtime event
      const io = req.app.get("io");
      emitOrderEvent(io, order.user_id, "order:statusUpdated", {
        id: Number(order.id),
        userId: Number(order.user_id),
        status,
      });

      return res.json({ success: true });
    } catch (err) {
      return next(err);
    }
  },
);

module.exports = router;
