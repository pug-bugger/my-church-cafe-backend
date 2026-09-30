const express = require("express");
const bcrypt = require("bcryptjs");
const { getPool } = require("../config/db");
const { signJwt } = require("../utils/jwt");
const { asyncHandler } = require("../utils/asyncHandler");
const { authMiddleware } = require("../middleware/auth");
const { google } = require("../config/env");
const {
  googleSignInConfigured,
  googleAccountsEnabled,
  verifyGoogleCredential,
  findLinkBySub,
  findLinkByUser,
  insertLink,
} = require("../lib/googleAuth");

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
    // An account created through Google has no password to check against.
    const valid =
      Boolean(user.password_hash) &&
      (await bcrypt.compare(password, user.password_hash));
    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    return res.json(sessionResponse(user));
  })
);

/** `{ token, user }` for a row shaped like `loadSessionUser`'s. */
function sessionResponse(user) {
  const role = user.role || "parishioner";
  const token = signJwt({
    id: user.id,
    email: user.email,
    role,
    organization_id: user.organization_id ?? null,
  });
  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role,
      picture_url: user.picture_url ?? null,
      organization_id: user.organization_id ?? null,
      organization_name: user.organization_name ?? null,
    },
  };
}

async function loadSessionUser(pool, userId) {
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.picture_url, u.organization_id,
            r.name AS role, o.name AS organization_name
     FROM users u
     LEFT JOIN roles r ON u.role_id = r.id
     LEFT JOIN organizations o ON u.organization_id = o.id
     WHERE u.id = ? LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

// ── Sign in with Google ─────────────────────────────────────────────────────

/**
 * Google routes have no fallback: without a client id there is nothing to
 * verify a token against, and without the migration nowhere to keep the link.
 */
const requireGoogle = asyncHandler(async (_req, res, next) => {
  if (!googleSignInConfigured()) {
    return res
      .status(503)
      .json({ error: "Google sign-in is not configured on the server." });
  }
  if (!(await googleAccountsEnabled(getPool()))) {
    return res.status(503).json({
      error:
        "Google sign-in needs a database update first: run scripts/migration_google_accounts.sql.",
    });
  }
  return next();
});

const isDuplicate = (err) => Boolean(err) && err.code === "ER_DUP_ENTRY";

// Public: whether to show the button, and the client id to render it with.
router.get(
  "/google/config",
  asyncHandler(async (_req, res) => {
    const enabled =
      googleSignInConfigured() && (await googleAccountsEnabled(getPool()));
    return res.json({
      enabled,
      clientId: enabled ? google.clientIds[0] : null,
    });
  })
);

/**
 * Sign in (or sign up) with a Google ID token. In order:
 *  1. a Google account already linked → that app account;
 *  2. an app account with the same email, which Google has verified → link
 *     it and sign in, so existing users keep their orders and role;
 *  3. otherwise a new parishioner account, linked from the start.
 */
router.post(
  "/google",
  requireGoogle,
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const profile = await verifyGoogleCredential(req.body?.credential);

    const link = await findLinkBySub(pool, profile.sub);
    let userId = link?.user_id ?? null;
    let status = 200;

    if (!userId) {
      if (!profile.email || !profile.emailVerified) {
        return res
          .status(400)
          .json({ error: "This Google account has no verified email address." });
      }
      const [existing] = await pool.query(
        "SELECT id FROM users WHERE email = ? LIMIT 1",
        [profile.email]
      );
      try {
        if (existing.length) {
          userId = existing[0].id;
          const current = await findLinkByUser(pool, userId);
          if (current) {
            return res.status(409).json({
              error:
                "The account with this email is connected to a different Google account.",
            });
          }
          await insertLink(pool, userId, profile);
        } else {
          const [roleRows] = await pool.query(
            "SELECT id FROM roles WHERE name = ? LIMIT 1",
            ["parishioner"]
          );
          const organizationId = await resolveOrganizationId(
            pool,
            req.body?.organization
          );
          const name =
            (profile.name || profile.email.split("@")[0]).slice(0, 100);
          const picture =
            profile.picture && profile.picture.length <= 512
              ? profile.picture
              : null;
          const [result] = await pool.query(
            `INSERT INTO users (name, email, password_hash, picture_url, role_id, organization_id)
             VALUES (?, ?, NULL, ?, ?, ?)`,
            [
              name,
              profile.email,
              picture,
              roleRows.length ? roleRows[0].id : null,
              organizationId,
            ]
          );
          userId = result.insertId;
          await insertLink(pool, userId, profile);
          status = 201;
        }
      } catch (err) {
        // Two sign-ins racing for the same account: the other one won.
        if (!isDuplicate(err)) throw err;
        return res
          .status(409)
          .json({ error: "Sign-in was already in progress. Try again." });
      }
    }

    const user = await loadSessionUser(pool, userId);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    return res
      .status(status)
      .json({ ...sessionResponse(user), created: status === 201 });
  })
);

async function linkStatus(pool, userId) {
  const link = await findLinkByUser(pool, userId);
  const [rows] = await pool.query(
    "SELECT password_hash IS NOT NULL AS has_password FROM users WHERE id = ?",
    [userId]
  );
  return {
    linked: Boolean(link),
    email: link?.email ?? null,
    linked_at: link?.linked_at ?? null,
    has_password: Boolean(rows[0]?.has_password),
  };
}

// Mine: which Google account (if any) is connected.
router.get(
  "/google/link",
  authMiddleware,
  requireGoogle,
  asyncHandler(async (req, res) => {
    return res.json(await linkStatus(getPool(), req.user.id));
  })
);

// Mine: connect a Google account — any one, its email needn't match mine.
router.post(
  "/google/link",
  authMiddleware,
  requireGoogle,
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const profile = await verifyGoogleCredential(req.body?.credential);

    const bySub = await findLinkBySub(pool, profile.sub);
    if (bySub && bySub.user_id !== req.user.id) {
      return res.status(409).json({
        error: "This Google account is already connected to another account.",
      });
    }
    if (!bySub) {
      if (await findLinkByUser(pool, req.user.id)) {
        return res.status(409).json({
          error: "Disconnect the current Google account first.",
        });
      }
      try {
        await insertLink(pool, req.user.id, profile);
      } catch (err) {
        if (!isDuplicate(err)) throw err;
        return res.status(409).json({
          error: "This Google account is already connected to another account.",
        });
      }
    }
    return res.json(await linkStatus(pool, req.user.id));
  })
);

// Mine: disconnect Google. Refused for an account with no password, which
// would otherwise have no way left to sign in.
router.delete(
  "/google/link",
  authMiddleware,
  requireGoogle,
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const status = await linkStatus(pool, req.user.id);
    if (status.linked && !status.has_password) {
      return res.status(409).json({
        error:
          "Set a password before disconnecting Google, or you won't be able to sign in.",
      });
    }
    await pool.query("DELETE FROM user_google_accounts WHERE user_id = ?", [
      req.user.id,
    ]);
    return res.json(await linkStatus(pool, req.user.id));
  })
);

module.exports = router;
