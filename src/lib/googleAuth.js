/**
 * Sign in with Google: ID-token verification and the account link table.
 *
 * Clients never send us a Google user id or email directly — they send the ID
 * token Google issued them (`credential`), and we verify its signature,
 * audience and expiry here. Everything downstream trusts only the verified
 * payload.
 */
const { OAuth2Client } = require("google-auth-library");
const { google } = require("../config/env");
const { hasColumn } = require("../utils/columns");

const client = new OAuth2Client();

function googleSignInConfigured() {
  return google.clientIds.length > 0;
}

/** Has `migration_google_accounts` run? */
function googleAccountsEnabled(pool) {
  return hasColumn(pool, "user_google_accounts", "google_sub");
}

/**
 * Verify a Google ID token. Resolves `{ sub, email, emailVerified, name,
 * picture }`, or throws a 401 error for anything that doesn't check out.
 */
async function verifyGoogleCredential(credential) {
  if (typeof credential !== "string" || !credential) {
    throw Object.assign(new Error("credential required"), { status: 400 });
  }
  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: google.clientIds,
    });
    payload = ticket.getPayload();
  } catch (_err) {
    payload = null;
  }
  if (!payload || !payload.sub) {
    throw Object.assign(new Error("Google sign-in could not be verified"), {
      status: 401,
    });
  }
  return {
    sub: String(payload.sub),
    email: payload.email ? String(payload.email) : null,
    emailVerified: payload.email_verified === true,
    name: payload.name ? String(payload.name) : null,
    picture: payload.picture ? String(payload.picture) : null,
  };
}

/** The link row for a Google subject, or null. */
async function findLinkBySub(pool, sub) {
  const [rows] = await pool.query(
    "SELECT user_id, google_sub, email FROM user_google_accounts WHERE google_sub = ? LIMIT 1",
    [sub],
  );
  return rows[0] ?? null;
}

/** The link row for an app account, or null. */
async function findLinkByUser(pool, userId) {
  const [rows] = await pool.query(
    "SELECT user_id, google_sub, email, linked_at FROM user_google_accounts WHERE user_id = ? LIMIT 1",
    [userId],
  );
  return rows[0] ?? null;
}

async function insertLink(pool, userId, google) {
  await pool.query(
    "INSERT INTO user_google_accounts (user_id, google_sub, email) VALUES (?, ?, ?)",
    [userId, google.sub, google.email],
  );
}

module.exports = {
  googleSignInConfigured,
  googleAccountsEnabled,
  verifyGoogleCredential,
  findLinkBySub,
  findLinkByUser,
  insertLink,
};
