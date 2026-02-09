const express = require("express");
const { getPool, withTransaction } = require("../config/db");
const { authMiddleware, requireRole } = require("../middleware/auth");

const router = express.Router();

// Public: list products with category
router.get("/", async (req, res, next) => {
  try {
    const { category_id } = req.query;
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT p.id, p.name, p.description, p.base_price, p.image_url, p.available,
              c.id as category_id, c.name as category_name
       FROM products p LEFT JOIN categories c ON p.category_id = c.id
       ${category_id ? "WHERE p.category_id = ?" : ""}
       ORDER BY p.name ASC`,
      category_id ? [category_id] : [],
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

// Public: list all product items
router.get("/items", async (_req, res, next) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, product_id, name, sku, price, available
       FROM product_items
       WHERE available = 1
       ORDER BY name ASC`,
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

// Public: get product with items and options
router.get("/:id", async (req, res, next) => {
  try {
    const pool = getPool();
    const [products] = await pool.query("SELECT * FROM products WHERE id = ?", [
      req.params.id,
    ]);
    if (!products.length) return res.status(404).json({ error: "Not found" });
    const product = products[0];
    const [items] = await pool.query(
      "SELECT * FROM product_items WHERE product_id = ? AND available = 1",
      [product.id],
    );
    const [options] = await pool.query(
      "SELECT * FROM product_options WHERE product_id = ?",
      [product.id],
    );
    return res.json({ ...product, items, options });
  } catch (err) {
    return next(err);
  }
});

// Protected writes
router.use(authMiddleware);

// Admin: create product
router.post("/", requireRole("admin"), async (req, res, next) => {
  try {
    const {
      category_id,
      name,
      description,
      base_price,
      image_url,
      available,
      items,
      options,
    } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    const result = await withTransaction(async (conn) => {
      const [r] = await conn.query(
        "INSERT INTO products (category_id, name, description, base_price, image_url, available) VALUES (?, ?, ?, ?, ?, ?)",
        [
          category_id || null,
          name,
          description || null,
          base_price || null,
          image_url || null,
          available !== false,
        ],
      );
      const productId = r.insertId;
      if (Array.isArray(items) && items.length) {
        const values = items.map((it) => [
          productId,
          it.name,
          it.sku || null,
          it.price || null,
          it.available !== false,
        ]);
        await conn.query(
          "INSERT INTO product_items (product_id, name, sku, price, available) VALUES ?",
          [values],
        );
      }
      if (Array.isArray(options) && options.length) {
        const values = options.map((op) => [
          productId,
          op.name,
          op.value,
          op.extra_price || 0,
        ]);
        await conn.query(
          "INSERT INTO product_options (product_id, name, value, extra_price) VALUES ?",
          [values],
        );
      }
      return productId;
    });
    return res.status(201).json({ id: result });
  } catch (err) {
    return next(err);
  }
});

// Admin: update product and optionally replace items/options
router.put("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const {
      category_id,
      name,
      description,
      base_price,
      image_url,
      available,
      items,
      options,
    } = req.body;
    const productId = req.params.id;
    await withTransaction(async (conn) => {
      await conn.query(
        "UPDATE products SET category_id = COALESCE(?, category_id), name = COALESCE(?, name), description = COALESCE(?, description), base_price = COALESCE(?, base_price), image_url = COALESCE(?, image_url), available = COALESCE(?, available) WHERE id = ?",
        [
          category_id ?? null,
          name || null,
          description || null,
          base_price ?? null,
          image_url || null,
          available,
          productId,
        ],
      );
      if (Array.isArray(items)) {
        await conn.query("DELETE FROM product_items WHERE product_id = ?", [
          productId,
        ]);
        if (items.length) {
          const values = items.map((it) => [
            productId,
            it.name,
            it.sku || null,
            it.price || null,
            it.available !== false,
          ]);
          await conn.query(
            "INSERT INTO product_items (product_id, name, sku, price, available) VALUES ?",
            [values],
          );
        }
      }
      if (Array.isArray(options)) {
        await conn.query("DELETE FROM product_options WHERE product_id = ?", [
          productId,
        ]);
        if (options.length) {
          const values = options.map((op) => [
            productId,
            op.name,
            op.value,
            op.extra_price || 0,
          ]);
          await conn.query(
            "INSERT INTO product_options (product_id, name, value, extra_price) VALUES ?",
            [values],
          );
        }
      }
    });
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

// Admin: delete product (cascade deletes items/options)
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const pool = getPool();
    await pool.query("DELETE FROM products WHERE id = ?", [req.params.id]);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

// Admin: add/update/delete single item
router.post("/:id/items", requireRole("admin"), async (req, res, next) => {
  try {
    const productId = req.params.id;
    const { name, sku, price, available } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    const pool = getPool();
    const [r] = await pool.query(
      "INSERT INTO product_items (product_id, name, sku, price, available) VALUES (?, ?, ?, ?, ?)",
      [productId, name, sku || null, price || null, available !== false],
    );
    return res.status(201).json({ id: r.insertId });
  } catch (err) {
    return next(err);
  }
});

router.put("/items/:itemId", requireRole("admin"), async (req, res, next) => {
  try {
    const { name, sku, price, available } = req.body;
    const pool = getPool();
    await pool.query(
      "UPDATE product_items SET name = COALESCE(?, name), sku = COALESCE(?, sku), price = COALESCE(?, price), available = COALESCE(?, available) WHERE id = ?",
      [name || null, sku || null, price ?? null, available, req.params.itemId],
    );
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

router.delete(
  "/items/:itemId",
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const pool = getPool();
      await pool.query("DELETE FROM product_items WHERE id = ?", [
        req.params.itemId,
      ]);
      return res.status(204).send();
    } catch (err) {
      return next(err);
    }
  },
);

// Admin: manage options
router.post("/:id/options", requireRole("admin"), async (req, res, next) => {
  try {
    const productId = req.params.id;
    const { name, value, extra_price } = req.body;
    if (!name || !value)
      return res.status(400).json({ error: "name and value required" });
    const pool = getPool();
    const [r] = await pool.query(
      "INSERT INTO product_options (product_id, name, value, extra_price) VALUES (?, ?, ?, ?)",
      [productId, name, value, extra_price || 0],
    );
    return res.status(201).json({ id: r.insertId });
  } catch (err) {
    return next(err);
  }
});

router.put(
  "/options/:optionId",
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const { name, value, extra_price } = req.body;
      const pool = getPool();
      await pool.query(
        "UPDATE product_options SET name = COALESCE(?, name), value = COALESCE(?, value), extra_price = COALESCE(?, extra_price) WHERE id = ?",
        [name || null, value || null, extra_price ?? null, req.params.optionId],
      );
      return res.json({ success: true });
    } catch (err) {
      return next(err);
    }
  },
);

router.delete(
  "/options/:optionId",
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const pool = getPool();
      await pool.query("DELETE FROM product_options WHERE id = ?", [
        req.params.optionId,
      ]);
      return res.status(204).send();
    } catch (err) {
      return next(err);
    }
  },
);

module.exports = router;
