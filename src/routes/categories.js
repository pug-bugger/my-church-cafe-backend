const express = require("express");
const { getPool } = require("../config/db");
const { authMiddleware, requireRole } = require("../middleware/auth");

const router = express.Router();

// Public: list categories (flat)
router.get("/", async (_req, res, next) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      "SELECT id, name, parent_id FROM categories ORDER BY name ASC"
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

// Public: get category by id
router.get("/:id", async (req, res, next) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      "SELECT id, name, parent_id FROM categories WHERE id = ?",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

// Protected writes
router.use(authMiddleware);

// Admin: create category
router.post("/", requireRole("admin"), async (req, res, next) => {
  try {
    const { name, parent_id } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    const pool = getPool();
    const [result] = await pool.query(
      "INSERT INTO categories (name, parent_id) VALUES (?, ?)",
      [name, parent_id || null]
    );
    return res
      .status(201)
      .json({ id: result.insertId, name, parent_id: parent_id || null });
  } catch (err) {
    return next(err);
  }
});

// Admin: update category
router.put("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const { name, parent_id } = req.body;
    if (!name && parent_id === undefined)
      return res.status(400).json({ error: "Nothing to update" });
    const pool = getPool();
    await pool.query(
      "UPDATE categories SET name = COALESCE(?, name), parent_id = ? WHERE id = ?",
      [name || null, parent_id ?? null, req.params.id]
    );
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

// Admin: delete category
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const pool = getPool();
    await pool.query("DELETE FROM categories WHERE id = ?", [req.params.id]);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
