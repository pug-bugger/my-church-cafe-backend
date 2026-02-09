const express = require("express");
const { getPool, withTransaction } = require("../config/db");
const { authMiddleware, requireRole } = require("../middleware/auth");

const router = express.Router();

router.use(authMiddleware);

const attachOrderItems = async (pool, orders) => {
  if (!orders.length) return orders;
  const orderIds = orders.map((order) => order.id);
  const [items] = await pool.query(
    `SELECT oi.id, oi.order_id, oi.product_item_id, oi.quantity, oi.price,
            pi.name AS product_item_name
     FROM order_items oi
     LEFT JOIN product_items pi ON oi.product_item_id = pi.id
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

// Create order from items: [{ product_item_id, quantity }]
router.post("/", async (req, res, next) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items required" });
    }

    const created = await withTransaction(async (conn) => {
      // Load item prices
      const ids = items.map((i) => i.product_item_id);
      const [rows] = await conn.query(
        `SELECT id, price FROM product_items WHERE id IN (?)`,
        [ids],
      );
      const priceById = new Map(rows.map((r) => [r.id, Number(r.price || 0)]));

      // Calculate total
      let total = 0;
      for (const it of items) {
        const price = priceById.get(it.product_item_id);
        if (price === undefined) {
          throw Object.assign(new Error("Invalid product_item_id"), {
            status: 400,
          });
        }
        const qty = Math.max(1, Number(it.quantity || 1));
        total += price * qty;
      }

      const [orderRes] = await conn.query(
        "INSERT INTO orders (user_id, total, status) VALUES (?, ?, ?)",
        [req.user.id, total, "pending"],
      );
      const newOrderId = orderRes.insertId;

      const orderItemValues = items.map((it) => [
        newOrderId,
        it.product_item_id,
        Math.max(1, Number(it.quantity || 1)),
        priceById.get(it.product_item_id),
      ]);
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

// Get my orders
router.get("/me", async (req, res, next) => {
  try {
    const pool = getPool();
    const [orders] = await pool.query(
      "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC",
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
    const [orders] = await pool.query("SELECT * FROM orders WHERE id = ?", [
      req.params.id,
    ]);
    if (!orders.length) return res.status(404).json({ error: "Not found" });
    const order = orders[0];
    if (
      order.user_id !== req.user.id &&
      req.user.role !== "admin" &&
      req.user.role !== "personal"
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const [items] = await pool.query(
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
      `SELECT o.*, u.name as user_name, u.email as user_email
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
