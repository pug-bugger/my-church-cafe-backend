const express = require("express");
const bcrypt = require("bcryptjs");
const { getPool } = require("../config/db");
const { signJwt } = require("../utils/jwt");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

async function resolveOrganizationId(pool, organizationName) {
  const name =
    typeof organizationName === "string" ? organizationName.trim() : "";
  const lookupName = name || "Default";
  const [existing] = await pool.query(
    "SELECT id FROM organizations WHERE name = ? LIMIT 1",
    [lookupName],
  );
  if (existing.length) return existing[0].id;
  const [result] = await pool.query(
    "INSERT INTO organizations (name) VALUES (?)",
    [lookupName],
  );
  return result.insertId;
}

// Register new user
router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { name, email, password, organization } = req.body;
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

    const organizationId = await resolveOrganizationId(pool, organization);

    const [result] = await pool.query(
      "INSERT INTO users (name, email, password_hash, role_id, organization_id) VALUES (?, ?, ?, ?, ?)",
      [name, email, passwordHash, roleId, organizationId]
    );

    const userId = result.insertId;
    const token = signJwt({
      id: userId,
      email,
      role: "parishioner",
      organization_id: organizationId,
    });
    return res.status(201).json({
      token,
      user: {
        id: userId,
        name,
        email,
        role: "parishioner",
        organization_id: organizationId,
      },
    });
  })
);

// Login
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email and password required" });
    }
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.picture_url, u.password_hash, u.organization_id,
              r.name AS role, o.name AS organization_name
       FROM users u
       LEFT JOIN roles r ON u.role_id = r.id
       LEFT JOIN organizations o ON u.organization_id = o.id
       WHERE u.email = ? LIMIT 1`,
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
      organization_id: user.organization_id ?? null,
    });
    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role || "parishioner",
        picture_url: user.picture_url ?? null,
        organization_id: user.organization_id ?? null,
        organization_name: user.organization_name ?? null,
      },
    });
  })
);

module.exports = router;
