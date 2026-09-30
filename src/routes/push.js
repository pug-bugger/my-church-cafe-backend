const express = require("express");
const { getPool } = require("../config/db");
const { authMiddleware } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");
const { isExpoPushToken } = require("../lib/pushClient");
const { normalizeLanguage } = require("../lib/notificationText");

const router = express.Router();

router.use(authMiddleware);

const PLATFORMS = ["ios", "android"];

function isMissingTable(err) {
  return Boolean(err) && err.code === "ER_NO_SUCH_TABLE";
}

// Register this device for the signed-in user. Called after sign-in and again
// whenever the app's language changes, so the server writes pushes in it.
router.post(
  "/token",
  asyncHandler(async (req, res) => {
    const { token, platform, language } = req.body ?? {};
    if (!isExpoPushToken(token)) {
      return res.status(400).json({ error: "token must be an Expo push token" });
    }
    if (!PLATFORMS.includes(platform)) {
      return res.status(400).json({ error: "platform must be ios or android" });
    }

    try {
      // The token is unique: re-registering it under another account moves it,
      // so a shared device only ever notifies whoever is signed in on it.
      await getPool().query(
        `INSERT INTO user_push_tokens (user_id, token, platform, language)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE user_id = VALUES(user_id),
           platform = VALUES(platform), language = VALUES(language)`,
        [req.user.id, token, platform, normalizeLanguage(language)],
      );
    } catch (err) {
      if (!isMissingTable(err)) throw err;
      return res.status(503).json({
        error:
          "Notifications need a database update first: run scripts/migration_push_tokens.sql.",
      });
    }
    return res.status(204).send();
  }),
);

// Unregister this device (sign-out). Only the caller's own token can be removed.
router.delete(
  "/token",
  asyncHandler(async (req, res) => {
    const token = req.body?.token;
    if (typeof token !== "string" || !token) {
      return res.status(400).json({ error: "token is required" });
    }
    try {
      await getPool().query(
        "DELETE FROM user_push_tokens WHERE token = ? AND user_id = ?",
        [token, req.user.id],
      );
    } catch (err) {
      // No table means nothing was ever registered — already unregistered.
      if (!isMissingTable(err)) throw err;
    }
    return res.status(204).send();
  }),
);

module.exports = router;
