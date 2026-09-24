const express = require("express");
const { getPool } = require("../config/db");
const { authMiddleware, requireRole } = require("../middleware/auth");
const { emitProductEvent } = require("../utils/productEvents");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

const MENU_NOTE_KEY = "menu_note";

/** Long enough for a few lines of small print, short enough to stay small print. */
const MENU_NOTE_MAX_LENGTH = 1000;

/**
 * The backend redeploys on a push while migrations run by hand, so the table
 * may not exist yet. Reading then answers "no note" — the menu must not go
 * down over a line of small print.
 */
function isMissingTable(err) {
  return Boolean(err) && err.code === "ER_NO_SUCH_TABLE";
}

// Public: the note printed under the menu board. Guests read the board too.
router.get(
  "/menu-note",
  asyncHandler(async (_req, res) => {
    try {
      const [rows] = await getPool().query(
        "SELECT setting_value FROM app_settings WHERE setting_key = ?",
        [MENU_NOTE_KEY],
      );
      res.json({ note: rows[0]?.setting_value ?? "" });
    } catch (err) {
      if (!isMissingTable(err)) throw err;
      res.json({ note: "" });
    }
  }),
);

// Admin: replace the note. An empty string clears it.
router.put(
  "/menu-note",
  authMiddleware,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const raw = req.body?.note;
    if (raw !== undefined && raw !== null && typeof raw !== "string") {
      return res.status(400).json({ error: "note must be a string" });
    }
    const note = (raw ?? "").trim();
    if (note.length > MENU_NOTE_MAX_LENGTH) {
      return res.status(400).json({
        error: `note must be at most ${MENU_NOTE_MAX_LENGTH} characters`,
      });
    }

    try {
      await getPool().query(
        `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [MENU_NOTE_KEY, note],
      );
    } catch (err) {
      if (!isMissingTable(err)) throw err;
      return res.status(503).json({
        error:
          "The menu note needs a database update first: run scripts/migration_app_settings.sql.",
      });
    }

    // Every client already refetches the menu on product:updated, so the note
    // rides along with it instead of needing an event of its own.
    emitProductEvent(req.app.get("io"), "product:updated", { menuNote: true });
    res.json({ note });
  }),
);

module.exports = router;
