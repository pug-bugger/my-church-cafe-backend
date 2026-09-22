const express = require("express");
const { appName, appVersion } = require("../config/version");
const { nodeEnv } = require("../config/env");

const router = express.Router();

/**
 * Public, unauthenticated: both clients print this beside their own version at
 * the foot of Profile. A half-finished deploy — new frontend, old backend — is
 * then something you can see rather than something you have to guess at, and a
 * bug report carries both numbers without anyone having to go and look.
 */
router.get("/", (_req, res) => {
  res.json({ name: appName, version: appVersion, env: nodeEnv });
});

module.exports = router;
