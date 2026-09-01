const express = require("express");
const { authMiddleware } = require("../middleware/auth");

const router = express.Router();

router.use(authMiddleware);

// Network printer connection status, shown on the profile page.
router.get("/status", (req, res) => {
  const printerClient = req.app.get("printerClient");
  return res.json(printerClient.getStatus());
});

module.exports = router;
