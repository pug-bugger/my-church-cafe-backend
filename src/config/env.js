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
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },
};
