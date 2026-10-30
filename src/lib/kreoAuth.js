/**
 * Sign in with Kreo: credential check against the Kreo REST API and the
 * account link table.
 *
 * Kreo's login endpoint needs the integration token (`KREO_API_TOKEN`), which
 * must never reach a browser or phone, so the clients send the email and
 * password here and we ask Kreo. Kreo's own user token is only proof of
 * identity: we revoke it straight away and issue our usual JWT instead.
 *
 * API docs: https://kreo.atsinaujinimas.lt/api/docs.php
 */
const { kreo } = require("../config/env");
const { hasColumn } = require("../utils/columns");

const TIMEOUT_MS = 10000;

function kreoSignInConfigured() {
  return Boolean(kreo.apiToken);
}

/** Has `migration_kreo_accounts` run? */
function kreoAccountsEnabled(pool) {
  return hasColumn(pool, "user_kreo_accounts", "kreo_person_id");
}

const fail = (status, message) =>
  Object.assign(new Error(message), { status });

/**
 * Check an email and password with Kreo. Resolves `{ id, email, name }` for
 * an active person, or throws an error carrying the status to answer with.
 */
async function verifyKreoLogin(email, password) {
  if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
    throw fail(400, "email and password required");
  }

  let res;
  let data = null;
  try {
    res = await fetch(`${kreo.apiUrl}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Kreo-Api-Token": kreo.apiToken,
      },
      body: JSON.stringify({
        email: email.trim(),
        password,
        remember: false,
        client: "Church Cafe",
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    data = await res.json().catch(() => null);
  } catch (_err) {
    throw fail(502, "Kreo could not be reached. Try again in a moment.");
  }

  if (!res.ok || !data?.ok) {
    const code = data?.error;
    if (code === "invalid_credentials" || code === "validation") {
      throw fail(401, "Wrong Kreo email or password.");
    }
    if (code === "email_unverified") {
      throw fail(403, "Confirm your email address with Kreo first.");
    }
    if (code === "unauthorized" || code === "forbidden") {
      // Our integration token was refused — a server setup problem, not the
      // person's.
      console.error("[kreo] API token rejected:", data?.message ?? res.status);
      throw fail(503, "Kreo sign-in is not set up correctly on the server.");
    }
    console.error("[kreo] login failed:", res.status, code ?? "");
    throw fail(502, "Kreo sign-in failed. Try again in a moment.");
  }

  // We only needed to know who this is.
  if (data.token) revokeKreoToken(data.token);

  const person = data.person;
  if (!person || !Number.isInteger(person.id)) {
    throw fail(502, "Kreo sign-in failed. Try again in a moment.");
  }
  if (person.is_active === false) {
    throw fail(403, "This Kreo account is inactive.");
  }
  const name =
    (typeof person.name === "string" && person.name.trim()) ||
    [person.first_name, person.last_name].filter(Boolean).join(" ").trim() ||
    null;
  return {
    id: person.id,
    email: person.email ? String(person.email) : email.trim(),
    name,
  };
}

/** Best-effort: revoke a Kreo user token. Never throws, never awaited. */
function revokeKreoToken(token) {
  fetch(`${kreo.apiUrl}/auth/logout`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "X-Kreo-Api-Token": kreo.apiToken,
      "X-Kreo-User-Token": token,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => {});
}

/** The link row for a Kreo person, or null. */
async function findLinkByPerson(pool, personId) {
  const [rows] = await pool.query(
    "SELECT user_id, kreo_person_id, email FROM user_kreo_accounts WHERE kreo_person_id = ? LIMIT 1",
    [personId],
  );
  return rows[0] ?? null;
}

/** The link row for an app account, or null. */
async function findLinkByUser(pool, userId) {
  const [rows] = await pool.query(
    "SELECT user_id, kreo_person_id, email, linked_at FROM user_kreo_accounts WHERE user_id = ? LIMIT 1",
    [userId],
  );
  return rows[0] ?? null;
}

async function insertLink(pool, userId, person) {
  await pool.query(
    "INSERT INTO user_kreo_accounts (user_id, kreo_person_id, email) VALUES (?, ?, ?)",
    [userId, person.id, person.email],
  );
}

module.exports = {
  kreoSignInConfigured,
  kreoAccountsEnabled,
  verifyKreoLogin,
  findLinkByPerson,
  findLinkByUser,
  insertLink,
};
