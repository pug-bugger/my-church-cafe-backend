const express = require("express");
const { getPool } = require("../config/db");
const { authMiddleware, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");
const {
  CARD_QR_PREFIX,
  customerCardsEnabled,
  ensureCardCode,
  assignCardCode,
  findUserByCard,
} = require("../lib/customerCard");

const router = express.Router();

router.use(authMiddleware);

/**
 * The card routes have no fallback before their migration: there is nothing
 * to show on a card without a code. So they answer 503 naming the migration,
 * the way `PUT /api/products/reorder` does.
 */
const requireCards = asyncHandler(async (_req, res, next) => {
  if (await customerCardsEnabled(getPool())) return next();
  return res.status(503).json({
    error:
      "Customer cards need a database update first: run scripts/migration_customer_card.sql.",
  });
});

router.use(requireCards);

const cardResponse = (code) => ({ code, qr: `${CARD_QR_PREFIX}${code}` });

// Mine: the code to render as a QR. Issued on first use.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const code = await ensureCardCode(getPool(), req.user.id);
    if (!code) return res.status(404).json({ error: "User not found" });
    return res.json(cardResponse(code));
  }),
);

// Mine: replace the code, so a photo or screenshot of the old card stops working.
router.post(
  "/reset",
  asyncHandler(async (req, res) => {
    const code = await assignCardCode(getPool(), req.user.id);
    if (!code) return res.status(404).json({ error: "User not found" });
    return res.json(cardResponse(code));
  }),
);

// Staff: who does this scanned card belong to? Name and photo, nothing more.
router.post(
  "/resolve",
  requireRole("admin", "personal"),
  asyncHandler(async (req, res) => {
    const customer = await findUserByCard(getPool(), req.body?.code);
    if (!customer) {
      return res.status(404).json({ error: "Customer card not recognised" });
    }
    return res.json({
      id: customer.id,
      name: customer.name,
      picture_url: customer.picture_url ?? null,
    });
  }),
);

module.exports = router;
