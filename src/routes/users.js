const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const { getPool } = require("../config/db");
const { uploadMaxImageBytes, uploadMaxImageMB } = require("../config/env");
const { authMiddleware, requireRole } = require("../middleware/auth");

const router = express.Router();

const uploadDir = path.join(__dirname, "../../uploads/users");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    const id = req.user?.id ?? req.params.id ?? "me";
    cb(null, `user-${id}-${Date.now()}${ext}`);
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

function unlinkUserPicture(pictureUrl) {
  if (
    pictureUrl &&
    typeof pictureUrl === "string" &&
    pictureUrl.startsWith("/uploads/users/")
  ) {
    const oldPath = path.join(__dirname, "../..", pictureUrl.replace(/^\//, ""));
    try {
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    } catch (_e) {
      /* ignore */
    }
  }
}

router.use(authMiddleware);

// Get current user profile
router.get("/me", async (req, res, next) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.picture_url, r.name as role, u.created_at
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

// Update current user (name, password, email, clear picture)
router.put("/me", async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const clearsPicture =
      Object.prototype.hasOwnProperty.call(req.body, "picture_url") &&
      req.body.picture_url === null;

    const pool = getPool();

    if (clearsPicture) {
      const [cur] = await pool.query(
        "SELECT picture_url FROM users WHERE id = ?",
        [req.user.id]
      );
      await pool.query("UPDATE users SET picture_url = NULL WHERE id = ?", [
        req.user.id,
      ]);
      unlinkUserPicture(cur[0]?.picture_url);
    }

    if (!name && !password && !clearsPicture)
      return res.status(400).json({ error: "Nothing to update" });

    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      await pool.query(
        "UPDATE users SET name = COALESCE(?, name), password_hash = ? WHERE id = ?",
        [name || null, passwordHash, req.user.id]
      );
    } else if (name != null || email != null) {
      await pool.query(
        "UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email) WHERE id = ?",
        [
          name != null ? name : null,
          email != null ? email : null,
          req.user.id,
        ]
      );
    }
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

// Current user: upload / replace profile picture
router.post(
  "/me/image",
  uploadImage.single("image"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ error: "No image file (field name: image)" });
      }
      const pool = getPool();
      const relativeUrl = `/uploads/users/${req.file.filename}`;
      const [rows] = await pool.query(
        "SELECT picture_url FROM users WHERE id = ?",
        [req.user.id]
      );
      if (!rows.length) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (_e) {
          /* ignore */
        }
        return res.status(404).json({ error: "User not found" });
      }
      unlinkUserPicture(rows[0].picture_url);
      await pool.query("UPDATE users SET picture_url = ? WHERE id = ?", [
        relativeUrl,
        req.user.id,
      ]);
      return res.json({ picture_url: relativeUrl });
    } catch (err) {
      return next(err);
    }
  }
);

// Admin + personal: list users
router.get("/", requireRole("admin", "personal"), async (_req, res, next) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.picture_url, r.name as role, u.created_at
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
    return res.status(201).json({
      id: result.insertId,
      name,
      email,
      role: role || null,
      picture_url: null,
    });
  } catch (err) {
    return next(err);
  }
});

// Admin: update user (name, role, email, optional password)
router.put("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const { name, role, email, password } = req.body;
    const userId = req.params.id;
    const pool = getPool();

    const [existingUser] = await pool.query(
      "SELECT id, picture_url FROM users WHERE id = ?",
      [userId]
    );
    if (!existingUser.length)
      return res.status(404).json({ error: "User not found" });

    let roleId = undefined;
    if (role !== undefined && role !== null && role !== "") {
      const [r] = await pool.query(
        "SELECT id FROM roles WHERE name = ? LIMIT 1",
        [role]
      );
      roleId = r.length ? r[0].id : null;
    }

    let emailToSet = undefined;
    if (typeof email === "string") {
      const trimmed = email.trim();
      if (trimmed) {
        const [dup] = await pool.query(
          "SELECT id FROM users WHERE email = ? AND id != ?",
          [trimmed, userId]
        );
        if (dup.length)
          return res.status(409).json({ error: "Email already exists" });
        emailToSet = trimmed;
      }
    }

    await pool.query(
      `UPDATE users SET
        name = COALESCE(?, name),
        role_id = COALESCE(?, role_id),
        email = COALESCE(?, email)
       WHERE id = ?`,
      [name || null, roleId !== undefined ? roleId : null, emailToSet ?? null, userId]
    );

    if (password && String(password).length > 0) {
      const passwordHash = await bcrypt.hash(password, 10);
      await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [
        passwordHash,
        userId,
      ]);
    }

    const clearsPicture =
      Object.prototype.hasOwnProperty.call(req.body, "picture_url") &&
      req.body.picture_url === null;
    if (clearsPicture) {
      await pool.query("UPDATE users SET picture_url = NULL WHERE id = ?", [
        userId,
      ]);
      unlinkUserPicture(existingUser[0].picture_url);
    }

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

// Admin: upload / replace user profile picture
router.post(
  "/:id/image",
  requireRole("admin"),
  uploadImage.single("image"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ error: "No image file (field name: image)" });
      }
      const userId = req.params.id;
      const pool = getPool();
      const relativeUrl = `/uploads/users/${req.file.filename}`;
      const [users] = await pool.query(
        "SELECT id, picture_url FROM users WHERE id = ?",
        [userId]
      );
      if (!users.length) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (_e) {
          /* ignore */
        }
        return res.status(404).json({ error: "User not found" });
      }
      unlinkUserPicture(users[0].picture_url);
      await pool.query("UPDATE users SET picture_url = ? WHERE id = ?", [
        relativeUrl,
        userId,
      ]);
      return res.json({ picture_url: relativeUrl });
    } catch (err) {
      return next(err);
    }
  }
);

// Admin: delete user
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    if (String(req.params.id) === String(req.user.id)) {
      return res.status(400).json({ error: "Cannot delete your own account" });
    }
    const pool = getPool();
    const [rows] = await pool.query(
      "SELECT picture_url FROM users WHERE id = ?",
      [req.params.id]
    );
    if (rows.length) unlinkUserPicture(rows[0].picture_url);
    await pool.query("DELETE FROM users WHERE id = ?", [req.params.id]);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
