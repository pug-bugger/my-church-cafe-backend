const express = require("express");
const { getPool, withTransaction } = require("../config/db");
const { authMiddleware, requireRole } = require("../middleware/auth");

const router = express.Router();

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

const attachOrderItems = async (pool, orders) => {
  if (!orders.length) return orders;
  const orderIds = orders.map((order) => order.id);
  const [items] = await pool.query(
    `SELECT oi.id, oi.order_id, oi.product_id, oi.quantity, oi.price,
                  p.name AS product_item_name
           FROM order_items oi
           LEFT JOIN products p ON oi.product_id = p.id
           WHERE oi.order_id IN (?)`,
    [orderIds],
  );
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

    const created = await withTransaction(async (conn) => {
      const productColumn = await getOrderItemProductColumn(conn);

      const normalizedItems = items.map((item) => {
        const quantity = Math.max(1, Number(item.quantity || 1));
        const productId =
          item.product_id ??
          item.productId ??
          item.product?.id ??
          (typeof item.product === "number" ? item.product : null);
        return {
          quantity,
          productId,
        };
      });

      console.log("productColumn", productColumn);

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
        console.log("productRows", productRows);

        const basePriceById = new Map(
          productRows.map((row) => [row.id, Number(row.base_price || 0)]),
        );
        // Calculate total
        let total = 0;
        for (const it of normalizedItems) {
          const basePrice = basePriceById.get(it.productId);
          if (basePrice === undefined) {
            throw Object.assign(new Error("Invalid product"), { status: 400 });
          }
          total += basePrice * it.quantity;
        }

        console.log("total", total);

        const [orderRes] = await conn.query(
          "INSERT INTO orders (user_id, total, status) VALUES (?, ?, ?)",
          [req.user.id, total, "pending"],
        );
        console.log("orderRes inserted");

        const newOrderId = orderRes.insertId;

        const orderItemValues = normalizedItems.map((it) => [
          newOrderId,
          it.productId,
          it.quantity,
          basePriceById.get(it.productId),
        ]);
        console.log("orderItemValues", orderItemValues);
        await conn.query(
          "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ?",
          [orderItemValues],
        );

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
        finalItemIds.forEach((id) => {
          console.log("invalid id", id);
          console.log(!Number.isFinite(Number(id)));
        });

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

      // Calculate total
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
        total += basePrice * it.quantity;
      }

      const [orderRes] = await conn.query(
        "INSERT INTO orders (user_id, total, status) VALUES (?, ?, ?)",
        [req.user.id, total, "pending"],
      );
      const newOrderId = orderRes.insertId;

      const orderItemValues = normalizedItems.map((it, idx) => {
        const primaryId = finalItemIds[idx];
        return [newOrderId, primaryId, it.quantity, priceById.get(primaryId)];
      });
      await conn.query(
        "INSERT INTO order_items (order_id, product_item_id, quantity, price) VALUES ?",
        [orderItemValues],
      );

      return { id: newOrderId, total };
    });

    // Realtime event
    const io = req.app.get("io");
    io?.to("staff").emit("order:created", {
      id: created.id,
      userId: req.user.id,
      total: created.total,
      status: "pending",
    });
    io?.to(`user:${req.user.id}`).emit("order:created", {
      id: created.id,
      userId: req.user.id,
      total: created.total,
      status: "pending",
    });

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
            `SELECT oi.id, oi.quantity, oi.price, p.name AS product_item_name
             FROM order_items oi LEFT JOIN products p ON oi.product_id = p.id
             WHERE oi.order_id = ?`,
            [order.id],
          )
        : await pool.query(
            `SELECT oi.id, oi.quantity, oi.price, pi.name AS product_item_name
             FROM order_items oi LEFT JOIN product_items pi ON oi.product_item_id = pi.id
             WHERE oi.order_id = ?`,
            [order.id],
          );
    return res.json({ ...order, items });
  } catch (err) {
    return next(err);
  }
});

// Admin: list all orders
router.get("/", requireRole("admin", "personal"), async (_req, res, next) => {
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
      io?.to("staff").emit("order:statusUpdated", {
        id: Number(order.id),
        userId: Number(order.user_id),
        status,
      });
      io?.to(`user:${order.user_id}`).emit("order:statusUpdated", {
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
