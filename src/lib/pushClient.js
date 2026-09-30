/**
 * Push notifications through the Expo Push Service.
 *
 * The mobile app registers an Expo push token (`POST /api/push/token`), and
 * Expo delivers to APNs / FCM on our behalf, so the server needs no Apple or
 * Google credentials of its own. They live with the app's EAS project.
 *
 * Talks to the HTTP API directly with Node's `fetch` rather than through
 * `expo-server-sdk`: it is one POST, and this keeps the backend free of a
 * dependency for it.
 *
 * Like printing, pushing is best-effort. `notifyUser` never throws, and callers
 * don't await it before answering the request: a slow or failing Expo must
 * never hold up or fail a status change.
 */
const { getPool } = require("../config/db");
const { notificationText } = require("./notificationText");

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** Expo accepts at most 100 messages per request. */
const CHUNK_SIZE = 100;
const REQUEST_TIMEOUT_MS = 10000;

/** Must match the channel the app creates on Android (`src/lib/push.ts`). */
const ANDROID_CHANNEL_ID = "orders";

const EXPO_TOKEN_PATTERN = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;

function isExpoPushToken(value) {
  return typeof value === "string" && EXPO_TOKEN_PATTERN.test(value);
}

function isMissingTable(err) {
  return Boolean(err) && err.code === "ER_NO_SUCH_TABLE";
}

/** POST messages to Expo; resolves to one ticket per message, in order. */
async function sendToExpo(messages) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  // Only needed if "enhanced push security" is switched on for the EAS project.
  if (process.env.EXPO_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  }

  const tickets = [];
  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const chunk = messages.slice(i, i + CHUNK_SIZE);
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(chunk),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        `Expo push rejected (${res.status}): ${JSON.stringify(payload.errors ?? payload)}`,
      );
    }
    tickets.push(...(Array.isArray(payload.data) ? payload.data : []));
  }
  return tickets;
}

/**
 * Notify every device a user has registered.
 *
 * @param {number|null|undefined} userId
 * @param {"orderReady"|"orderCancelled"} key - message in `notificationText.js`
 * @param {Record<string, string|number>} values - placeholder values
 * @param {Record<string, unknown>} data - handed to the app when the notification is tapped
 */
async function notifyUser(userId, key, values = {}, data = {}) {
  if (userId == null) return;
  try {
    const pool = getPool();
    let rows;
    try {
      [rows] = await pool.query(
        "SELECT token, language FROM user_push_tokens WHERE user_id = ?",
        [userId],
      );
    } catch (err) {
      // Deployed before migration_push_tokens ran: nobody can be registered yet.
      if (isMissingTable(err)) return;
      throw err;
    }
    if (!rows.length) return;

    const messages = rows.map((row) => {
      const { title, body } = notificationText(key, row.language, values);
      return {
        to: row.token,
        title,
        body,
        data: { kind: key, ...data },
        sound: "default",
        priority: "high",
        channelId: ANDROID_CHANNEL_ID,
      };
    });

    const tickets = await sendToExpo(messages);

    // A token Expo reports as no longer registered belongs to an app that was
    // uninstalled or signed out without telling us. Drop it, or every later
    // push will fail on it too.
    const stale = tickets
      .map((ticket, index) =>
        ticket?.status === "error" &&
        ticket.details?.error === "DeviceNotRegistered"
          ? messages[index].to
          : null,
      )
      .filter(Boolean);
    if (stale.length) {
      await pool.query("DELETE FROM user_push_tokens WHERE token IN (?)", [stale]);
    }

    const failed = tickets.filter((ticket) => ticket?.status === "error");
    if (failed.length > stale.length) {
      console.warn(
        "Some push notifications were refused:",
        failed.map((ticket) => ticket.message).join("; "),
      );
    }
  } catch (err) {
    console.error("Push notification failed:", err);
  }
}

module.exports = { notifyUser, isExpoPushToken };
