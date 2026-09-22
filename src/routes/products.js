const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { getPool, withTransaction } = require("../config/db");
const { uploadMaxImageBytes } = require("../config/env");
const { authMiddleware, requireRole } = require("../middleware/auth");
const {
  fetchDrinkOptionsForProducts,
  normalizeDrinkOptionsList,
} = require("../utils/drinkOptionsForProducts");
const { emitProductEvent } = require("../utils/productEvents");
const { ensureUploadDir } = require("../utils/uploadDir");
const { asyncHandler } = require("../utils/asyncHandler");
const { hasColumn } = require("../utils/columns");

const router = express.Router();

/**
 * Whether `products.sort_order` has been migrated in yet.
 *
 * Until it is, the catalogue keeps coming back in `name ASC` — the order it
 * came back in before the hand-picked sequence existed (see utils/columns.js).
 */
const hasSortOrder = (conn) => hasColumn(conn, "products", "sort_order");

const uploadDir = path.join(__dirname, "../../uploads/products");
ensureUploadDir(uploadDir);

/**
 * Extension to store an upload under, keyed by the MIME type `fileFilter` has
 * already vetted. Derived from the type rather than the client's filename
 * because mobile pickers routinely report a source name like `IMG_1234.heic`
 * for a file they have already re-encoded to JPEG — and a `.heic` URL is one
 * browsers refuse to render.
 */
const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = EXT_BY_MIME[String(file.mimetype).toLowerCase()] || ".jpg";
    cb(null, `product-${req.params.id}-${Date.now()}${ext}`);
  },
});

const uploadImage = multer({
  storage,
  limits: { fileSize: uploadMaxImageBytes },
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
    const { category_id, parent_category_id } = req.query;
    const pool = getPool();

    // Auto-restore products whose temporary hide has expired
    await pool.query(
      "UPDATE products SET available = 1, available_until = NULL WHERE available = 0 AND available_until IS NOT NULL AND available_until <= NOW()",
    );

    const conditions = [];
    const params = [];
    if (category_id) {
      conditions.push("p.category_id = ?");
      params.push(category_id);
    }
    if (parent_category_id) {
      conditions.push("(c.parent_id = ? OR p.category_id = ?)");
      params.push(parent_category_id, parent_category_id);
    }
    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";
    // The hand-picked sequence leads; the name is the tie-break, so a product
    // created before its first reorder still lands somewhere sensible.
    const ordered = await hasSortOrder(pool);
    const [rows] = await pool.query(
      `SELECT p.id, p.name, p.description, p.base_price, p.image_url, p.available, p.available_until,
              ${ordered ? "p.sort_order," : ""}
              c.id as category_id, c.name as category_name, c.parent_id as category_parent_id,
              pc.id as parent_category_id, pc.name as parent_category_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN categories pc ON c.parent_id = pc.id
       ${whereClause}
       ORDER BY ${ordered ? "p.sort_order ASC, " : ""}p.name ASC`,
      params,
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

// Admin: set product availability (show / hide forever / hide until midnight tonight)
router.patch(
  "/:id/availability",
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const { available, hide_until_midnight } = req.body;
      if (typeof available !== "boolean" && available !== 0 && available !== 1) {
        return res.status(400).json({ error: "available must be a boolean" });
      }
      let dbAvailableUntil = null;
      if (!available && hide_until_midnight) {
        // Compute server-local midnight as MySQL DATETIME (YYYY-MM-DD HH:MM:SS)
        const midnight = new Date();
        midnight.setHours(24, 0, 0, 0);
        const pad = (n) => String(n).padStart(2, "0");
        dbAvailableUntil = `${midnight.getFullYear()}-${pad(midnight.getMonth() + 1)}-${pad(midnight.getDate())} ${pad(midnight.getHours())}:${pad(midnight.getMinutes())}:${pad(midnight.getSeconds())}`;
      }
      const pool = getPool();
      await pool.query(
        "UPDATE products SET available = ?, available_until = ? WHERE id = ?",
        [available ? 1 : 0, dbAvailableUntil, req.params.id],
      );
      emitProductEvent(req.app.get("io"), "product:updated", {
        id: Number(req.params.id),
      });
      return res.json({ success: true });
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * Admin: set the order products are shown in.
 *
 * Takes the whole sequence — `{ ids: [7, 3, 12, …] }` — rather than "move this
 * one up", because the clients already hold the full list and sending it back
 * is the only version that can't drift: two admins reordering at once end up
 * with one of the two sequences, never an interleaving of both.
 *
 * Ids the body leaves out keep the position they had, behind everything named
 * here, so a client working from a filtered list can't silently bury the rest
 * of the catalogue.
 *
 * Registered before `PUT /:id` — otherwise "reorder" is read as a product id.
 */
router.put(
  "/reorder",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const raw = Array.isArray(req.body?.ids) ? req.body.ids : null;
    if (!raw || !raw.length) {
      return res.status(400).json({ error: "ids must be a non-empty array" });
    }
    const ids = raw.map((id) => Number(id));
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
      return res.status(400).json({ error: "ids must be product ids" });
    }
    if (new Set(ids).size !== ids.length) {
      return res.status(400).json({ error: "ids must not repeat" });
    }

    const pool = getPool();
    if (!(await hasSortOrder(pool))) {
      return res.status(503).json({
        error:
          "Product ordering needs scripts/migration_product_sort_order.sql to be run first",
      });
    }

    await withTransaction(async (conn) => {
      // Everything not named keeps its relative order but sits behind the
      // named run, so the numbers stay a single contiguous sequence.
      await conn.query(
        "UPDATE products SET sort_order = sort_order + ? WHERE id NOT IN (?)",
        [ids.length, ids],
      );
      for (let i = 0; i < ids.length; i += 1) {
        await conn.query("UPDATE products SET sort_order = ? WHERE id = ?", [
          i + 1,
          ids[i],
        ]);
      }
    });

    emitProductEvent(req.app.get("io"), "product:updated", { reordered: true });
    return res.json({ success: true, count: ids.length });
  }),
);

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
      // A new product goes to the end of the hand-picked order rather than to
      // position 0, where a default of 0 would otherwise put it — ahead of
      // everything the cafe deliberately arranged.
      const ordered = await hasSortOrder(conn);
      let nextSortOrder = 0;
      if (ordered) {
        const [[{ next }]] = await conn.query(
          "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM products",
        );
        nextSortOrder = next;
      }
      const [r] = await conn.query(
        `INSERT INTO products (category_id, name, description, base_price, image_url, available
                ${ordered ? ", sort_order" : ""})
         VALUES (?, ?, ?, ?, ?, ?${ordered ? ", ?" : ""})`,
        [
          category_id || null,
          name,
          description || null,
          base_price || null,
          image_url || null,
          available !== false,
          ...(ordered ? [nextSortOrder] : []),
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
    emitProductEvent(req.app.get("io"), "product:created", { id: result });
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
    emitProductEvent(req.app.get("io"), "product:updated", {
      id: Number(req.params.id),
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
    emitProductEvent(req.app.get("io"), "product:deleted", {
      id: Number(req.params.id),
    });
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
