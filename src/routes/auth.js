const express = require("express");
const bcrypt = require("bcryptjs");
const { getPool } = require("../config/db");
const { signJwt } = require("../utils/jwt");

const router = express.Router();

// Register new user
router.post("/register", async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email, password required" });
    }

    const pool = getPool();
    const [existing] = await pool.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Default role: parishioner
    const [roleRows] = await pool.query(
      "SELECT id, name FROM roles WHERE name = ? LIMIT 1",
      ["parishioner"]
    );
    const roleId = roleRows.length ? roleRows[0].id : null;

    const [result] = await pool.query(
      "INSERT INTO users (name, email, password_hash, role_id) VALUES (?, ?, ?, ?)",
      [name, email, passwordHash, roleId]
    );

    const userId = result.insertId;
    const token = signJwt({ id: userId, email, role: "parishioner" });
    return res
      .status(201)
      .json({ token, user: { id: userId, name, email, role: "parishioner" } });
  } catch (err) {
    return next(err);
  }
});

// Login
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email and password required" });
    }
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.password_hash, r.name AS role
       FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.email = ? LIMIT 1`,
      [email]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = signJwt({
      id: user.id,
      email: user.email,
      role: user.role || "parishioner",
    });
    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role || "parishioner",
      },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
