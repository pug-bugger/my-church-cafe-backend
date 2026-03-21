const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { getPool, withTransaction } = require("../config/db");
const { authMiddleware, requireRole } = require("../middleware/auth");
const {
  fetchDrinkOptionsForProducts,
  normalizeDrinkOptionsList,
} = require("../utils/drinkOptionsForProducts");

const router = express.Router();

const uploadDir = path.join(__dirname, "../../uploads/products");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `product-${req.params.id}-${Date.now()}${ext}`);
  },
});

const uploadImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype)) {
      const err = new Error("Only JPEG, PNG, GIF, or WebP images are allowed");
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

async function attachDrinkOptions(pool, productRows) {
  if (!productRows.length) return productRows;
  const ids = productRows.map((p) => p.id);
  const map = await fetchDrinkOptionsForProducts(pool, ids);
  return productRows.map((p) => ({
    ...p,
    drink_options: normalizeDrinkOptionsList(map.get(p.id) || []),
  }));
}

// Public: list products with category and drink options
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
    const withOptions = await attachDrinkOptions(pool, rows);
    return res.json(withOptions);
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

// Public: get product with items and drink options
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
    const [withOpts] = await attachDrinkOptions(pool, [product]);
    return res.json({ ...withOpts, items });
  } catch (err) {
    return next(err);
  }
});

// Protected writes
router.use(authMiddleware);

// Admin: upload / replace product image
router.post(
  "/:id/image",
  requireRole("admin"),
  uploadImage.single("image"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image file (field name: image)" });
      }
      const pool = getPool();
      const relativeUrl = `/uploads/products/${req.file.filename}`;
      const [products] = await pool.query(
        "SELECT id, image_url FROM products WHERE id = ?",
        [req.params.id],
      );
      if (!products.length) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (_e) {
          /* ignore */
        }
        return res.status(404).json({ error: "Product not found" });
      }
      const prev = products[0].image_url;
      if (
        prev &&
        typeof prev === "string" &&
        prev.startsWith("/uploads/products/")
      ) {
        const oldPath = path.join(
          __dirname,
          "../..",
          prev.replace(/^\//, ""),
        );
        try {
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        } catch (_e) {
          /* ignore */
        }
      }
      await pool.query("UPDATE products SET image_url = ? WHERE id = ?", [
        relativeUrl,
        req.params.id,
      ]);
      return res.json({ image_url: relativeUrl });
    } catch (err) {
      return next(err);
    }
  },
);

async function syncProductDrinkOptions(conn, productId, definitionIds) {
  if (!Array.isArray(definitionIds)) return;
  await conn.query("DELETE FROM product_drink_options WHERE product_id = ?", [
    productId,
  ]);
  const ids = definitionIds
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length) return;
  const rows = ids.map((defId, i) => [productId, defId, i]);
  await conn.query(
    "INSERT INTO product_drink_options (product_id, option_definition_id, sort_order) VALUES ?",
    [rows],
  );
}

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
      drink_option_definition_ids,
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
      await syncProductDrinkOptions(conn, productId, drink_option_definition_ids);
      return productId;
    });
    return res.status(201).json({ id: result });
  } catch (err) {
    return next(err);
  }
});

// Admin: update product
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
      drink_option_definition_ids,
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
      if (Array.isArray(drink_option_definition_ids)) {
        await syncProductDrinkOptions(conn, productId, drink_option_definition_ids);
      }
    });
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

// Admin: delete product
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

module.exports = router;
