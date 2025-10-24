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
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

module.exports = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),
  db: {
    host: required("DB_HOST", "localhost"),
    port: Number(process.env.DB_PORT || 3306),
    user: required("DB_USER", "root"),
    password: required("DB_PASSWORD", ""),
    database: required("DB_NAME", "church_cafe"),
  },
  auth: {
    jwtSecret: required("JWT_SECRET", "change_this_secret"),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },
};
