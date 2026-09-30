/**
 * Customer cards — the QR code a customer shows at the counter so the terminal
 * can attach an order to their account instead of a typed name.
 *
 * The QR carries `cc:card:<code>`, where the code is a random 128-bit value
 * stored on the user (`users.card_code`). It is static on purpose (it works
 * with the phone offline, and a laminated printout would work too), so it is
 * only ever as secret as the card itself. That is why it resolves to nothing
 * more than a name and a photo, and only for staff, and why the owner can
 * reset it.
 */
const crypto = require("crypto");
const { hasColumn } = require("../utils/columns");

const CARD_QR_PREFIX = "cc:card:";

/** base64url of 16 random bytes: 22 characters. The pattern allows some slack. */
const CARD_CODE_PATTERN = /^[A-Za-z0-9_-]{16,32}$/;

function generateCardCode() {
  return crypto.randomBytes(16).toString("base64url");
}

/**
 * Whether the card migration has run. Both columns arrive in one migration, so
 * both are checked: a half-applied one must not look like a working feature.
 */
async function customerCardsEnabled(conn) {
  const [cards, orders] = await Promise.all([
    hasColumn(conn, "users", "card_code"),
    hasColumn(conn, "orders", "customer_user_id"),
  ]);
  return cards && orders;
}

/**
 * Accept what the scanner read (`cc:card:<code>`) or the bare code. Anything
 * else, such as a URL or some other shop's loyalty QR, is `null`.
 */
function parseCardPayload(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const code = trimmed.startsWith(CARD_QR_PREFIX)
    ? trimmed.slice(CARD_QR_PREFIX.length)
    : trimmed;
  return CARD_CODE_PATTERN.test(code) ? code : null;
}

/** The user's card code, issuing one on first use. */
async function ensureCardCode(conn, userId) {
  const [rows] = await conn.query("SELECT card_code FROM users WHERE id = ?", [
    userId,
  ]);
  if (!rows.length) return null;
  if (rows[0].card_code) return rows[0].card_code;
  return assignCardCode(conn, userId, { onlyIfMissing: true });
}

/**
 * Write a fresh code. `onlyIfMissing` makes a first issue race-safe: two
 * devices opening the card at once both read back the one code that won.
 */
async function assignCardCode(conn, userId, { onlyIfMissing = false } = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = generateCardCode();
    try {
      await conn.query(
        `UPDATE users SET card_code = ? WHERE id = ?${
          onlyIfMissing ? " AND card_code IS NULL" : ""
        }`,
        [code, userId],
      );
    } catch (err) {
      // A collision on 128 random bits is not going to happen, but if it does
      // the answer is just another roll.
      if (err && err.code === "ER_DUP_ENTRY") continue;
      throw err;
    }
    const [rows] = await conn.query(
      "SELECT card_code FROM users WHERE id = ?",
      [userId],
    );
    return rows[0]?.card_code ?? null;
  }
  throw new Error("Could not issue a card code");
}

/** `{ id, name, picture_url }` for a scanned card, or `null`. */
async function findUserByCard(conn, rawPayload) {
  const code = parseCardPayload(rawPayload);
  if (!code) return null;
  const [rows] = await conn.query(
    "SELECT id, name, picture_url FROM users WHERE card_code = ? LIMIT 1",
    [code],
  );
  return rows[0] ?? null;
}

module.exports = {
  CARD_QR_PREFIX,
  customerCardsEnabled,
  parseCardPayload,
  ensureCardCode,
  assignCardCode,
  findUserByCard,
};
