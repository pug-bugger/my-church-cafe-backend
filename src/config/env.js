const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

// Load .env if present; fallback to env vars
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const required = (key, fallback) => {
  const value = process.env[key] ?? fallback;
  if (value === undefined || value === null) {
    //  || String(value).trim() === ""
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const parseCorsOrigin = () => {
  const raw = process.env.CORS_ORIGIN;
  // If not set, keep previous permissive behavior.
  if (!raw) return true;
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed === "*") return true;
  // Comma-separated list of allowed origins
  const parts = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return true;
  return parts.length === 1 ? parts[0] : parts;
};

/** Max image upload size (MB) for multer; increase nginx/proxy limits to match or exceed this. */
const uploadMaxImageMB = (() => {
  const n = Number(process.env.UPLOAD_MAX_IMAGE_MB);
  if (Number.isFinite(n) && n > 0) return Math.min(50, Math.max(1, n));
  return 15;
})();

/**
 * Days a session survives without the app being opened. A token lives this
 * long, and the clients trade it for a fresh one (POST /api/auth/refresh) when
 * they are opened a day or more after it was issued — so the window counts
 * from the last time the app was used, not from sign-in.
 */
const sessionIdleDays = (() => {
  const n = Number(process.env.SESSION_IDLE_DAYS);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return 60;
})();

module.exports = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),
  corsOrigin: parseCorsOrigin(),
  uploadMaxImageMB,
  uploadMaxImageBytes: uploadMaxImageMB * 1024 * 1024,
  db: {
    host: required("DB_HOST", "localhost"),
    port: Number(process.env.DB_PORT || 3306),
    user: required("DB_USER", "root"),
    password: required("DB_PASSWORD", ""),
    database: required("DB_NAME", "church_cafe_db"),
  },
  auth: {
    jwtSecret: required("JWT_SECRET", "change_this_secret"),
    sessionIdleDays,
    // Deliberately not JWT_EXPIRES_IN: existing .env files pin that to 7d,
    // which would quietly cut the two-month window down to a week.
    jwtExpiresIn: `${sessionIdleDays}d`,
  },
  google: {
    // OAuth client ids whose ID tokens are accepted (comma-separated: the web
    // client, plus the iOS/Android ones once the mobile app signs in too).
    // The first is handed to the web app. Empty = Google sign-in disabled.
    clientIds: String(process.env.GOOGLE_CLIENT_ID || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
  printer: {
    // Network receipt printer reached via raw TCP/IP printing (port 9100).
    // host unset = printing disabled (status shows "not configured").
    host: process.env.PRINTER_HOST || null,
    port: Number(process.env.PRINTER_PORT || 9100),
  },
};
