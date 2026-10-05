const express = require("express");
const { getPool } = require("../config/db");
const { authMiddleware, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");
const { searchCustomerNames } = require("../lib/customerNames");

const router = express.Router();

/** Upper bound on `limit` — a dropdown under a text field, not a report. */
const MAX_LIMIT = 20;

// Staff: names to suggest while typing "Customer name" on the terminal.
// Names are added by POST /api/orders, not here. GET ?q=<typed>&limit=<n>.
router.get(
  "/",
  authMiddleware,
  requireRole("admin", "personal"),
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const requested = Number.parseInt(String(req.query.limit ?? ""), 10);
    const limit =
      Number.isFinite(requested) && requested > 0
        ? Math.min(requested, MAX_LIMIT)
        : 8;
    const names = await searchCustomerNames(
      getPool(),
      req.user.organization_id,
      q,
      limit,
    );
    res.json(names);
  }),
);

module.exports = router;
