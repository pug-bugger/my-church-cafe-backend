const jwt = require("jsonwebtoken");
const { auth } = require("../config/env");

function signJwt(payload) {
  return jwt.sign(payload, auth.jwtSecret, { expiresIn: auth.jwtExpiresIn });
}

/**
 * Verify a token's signature and, unless `ignoreExpiration` is set, its expiry.
 * Only a sign-out step should ever skip the expiry check.
 */
function verifyJwt(token, { ignoreExpiration = false } = {}) {
  return jwt.verify(token, auth.jwtSecret, { ignoreExpiration });
}

module.exports = { signJwt, verifyJwt };
