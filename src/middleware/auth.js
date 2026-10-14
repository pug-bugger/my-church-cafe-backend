const { verifyJwt } = require("../utils/jwt");

function authenticate({ allowExpired = false } = {}) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const token = authHeader.split(" ")[1];
    try {
      const decoded = verifyJwt(token, { ignoreExpiration: allowExpired });
      req.user = decoded;
      return next();
    } catch (err) {
      return res.status(401).json({ error: "Invalid token" });
    }
  };
}

const authMiddleware = authenticate();

/**
 * Accepts a genuine token even after it has expired. Only for cleaning up
 * after a session that timed out (removing the device's push token), so that
 * a phone left unopened for months stops getting that account's pushes.
 */
const authMiddlewareAllowExpired = authenticate({ allowExpired: true });

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient role" });
    }
    return next();
  };
}

module.exports = { authMiddleware, authMiddlewareAllowExpired, requireRole };
