const express = require("express");
const bcrypt = require("bcryptjs");
const { getPool } = require("../config/db");
const { authMiddleware, requireRole } = require("../middleware/auth");

const router = express.Router();

router.use(authMiddleware);

// Get current user profile
router.get("/me", async (req, res, next) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, r.name as role, u.created_at
       FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = ?`,
      [req.user.id]
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "User not found" });
    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

// Update current user (name, password)
router.put("/me", async (req, res, next) => {
  try {
    const { name, password } = req.body;
    if (!name && !password)
      return res.status(400).json({ error: "Nothing to update" });
    const pool = getPool();
    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      await pool.query(
        "UPDATE users SET name = COALESCE(?, name), password_hash = ? WHERE id = ?",
        [name || null, passwordHash, req.user.id]
      );
    } else {
      await pool.query("UPDATE users SET name = ? WHERE id = ?", [
        name,
        req.user.id,
      ]);
    }
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

// Admin: list users
router.get("/", requireRole("admin", "personal"), async (_req, res, next) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, r.name as role, u.created_at
       FROM users u LEFT JOIN roles r ON u.role_id = r.id ORDER BY u.created_at DESC`
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

// Admin: create user
router.post("/", requireRole("admin"), async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: "name, email, password required" });
    const pool = getPool();
    const [existing] = await pool.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );
    if (existing.length > 0)
      return res.status(409).json({ error: "Email already exists" });

    const passwordHash = await bcrypt.hash(password, 10);
    let roleId = null;
    if (role) {
      const [r] = await pool.query(
        "SELECT id FROM roles WHERE name = ? LIMIT 1",
        [role]
      );
      roleId = r.length ? r[0].id : null;
    }
    const [result] = await pool.query(
      "INSERT INTO users (name, email, password_hash, role_id) VALUES (?, ?, ?, ?)",
      [name, email, passwordHash, roleId]
    );
    return res
      .status(201)
      .json({ id: result.insertId, name, email, role: role || null });
  } catch (err) {
    return next(err);
  }
});

// Admin: update user role or name
router.put("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const { name, role } = req.body;
    const userId = req.params.id;
    const pool = getPool();
    let roleId = null;
    if (role) {
      const [r] = await pool.query(
        "SELECT id FROM roles WHERE name = ? LIMIT 1",
        [role]
      );
      roleId = r.length ? r[0].id : null;
    }
    await pool.query(
      "UPDATE users SET name = COALESCE(?, name), role_id = COALESCE(?, role_id) WHERE id = ?",
      [name || null, roleId, userId]
    );
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

// Admin: delete user
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const pool = getPool();
    await pool.query("DELETE FROM users WHERE id = ?", [req.params.id]);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
