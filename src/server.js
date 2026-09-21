const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const http = require("http");
const { Server } = require("socket.io");
const { verifyJwt } = require("./utils/jwt");
const { port, nodeEnv, corsOrigin, uploadMaxImageMB } = require("./config/env");
const printerClient = require("./lib/printerClient");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const categoryRoutes = require("./routes/categories");
const productRoutes = require("./routes/products");
const drinkOptionRoutes = require("./routes/drinkOptions");
const orderRoutes = require("./routes/orders");
const deviceStatusRoutes = require("./routes/deviceStatus");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: corsOrigin, credentials: true },
});

// Make io available inside route handlers (req.app.get("io"))
app.set("io", io);

// Network receipt printer over raw TCP/IP (port 9100). Reachable via
// req.app.get("printerClient"); polls the printer for reachability.
printerClient.init();
app.set("printerClient", printerClient);

// Socket auth via JWT: send `auth: { token }` or `Authorization: Bearer <token>`
io.use((socket, next) => {
  const tokenFromAuth = socket.handshake.auth?.token;
  const header = socket.handshake.headers?.authorization;
  const tokenFromHeader =
    typeof header === "string" && header.startsWith("Bearer ")
      ? header.slice("Bearer ".length)
      : undefined;
  const token = tokenFromAuth || tokenFromHeader;
  if (!token) {
    const err = new Error("Unauthorized");
    err.data = { code: "UNAUTHORIZED" };
    return next(err);
  }
  try {
    const user = verifyJwt(token);
    socket.data.user = user;
    return next();
  } catch (_e) {
    const err = new Error("Unauthorized");
    err.data = { code: "UNAUTHORIZED" };
    return next(err);
  }
});

io.on("connection", (socket) => {
  const user = socket.data.user;
  // Per-user room
  if (user?.id) socket.join(`user:${user.id}`);
  // Staff room (admin + personal)
  if (user?.role === "admin" || user?.role === "personal") {
    socket.join("staff");
  }

  socket.emit("socket:ready", {
    userId: user?.id,
    role: user?.role,
  });
});

// Middleware
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(
  "/uploads",
  express.static(path.join(__dirname, "../uploads")),
);
app.use(express.json());
app.use(morgan(nodeEnv === "production" ? "combined" : "dev"));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", env: nodeEnv });
});

// Root
app.get("/", (_req, res) => {
  res.json({ name: "Church Cafe Backend", version: "1.0.0" });
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/products", productRoutes);
app.use("/api/drink-options", drinkOptionRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/device", deviceStatusRoutes);

// 404 handler.
app.use((_req, res) => {
  res.status(404).json({ error: "Not Found" });
});

/**
 * A write that failed for reasons the caller can do nothing about. Almost
 * always `shared/uploads/` not being writable by the user PM2 runs as, which
 * otherwise surfaces to whoever changed their photo as a raw `EACCES` naming a
 * server path.
 */
const UPLOAD_WRITE_ERRORS = {
  EACCES: "The server could not save the file: its upload folder is not writable.",
  EPERM: "The server could not save the file: its upload folder is not writable.",
  EROFS: "The server could not save the file: its upload folder is read-only.",
  ENOSPC: "The server could not save the file: it has run out of disk space.",
};

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err); // In production consider structured logging
  if (err && err.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: `Image too large (max ${uploadMaxImageMB} MB).`,
      });
    }
    return res.status(400).json({ error: err.message || "Upload error" });
  }

  const uploadWriteError = err && UPLOAD_WRITE_ERRORS[err.code];
  if (uploadWriteError) {
    // The syscall, path and stack are in the log line above; staff get the one
    // sentence that tells them what to go and fix.
    return res.status(500).json({ error: uploadWriteError });
  }

  // A status on the error means a route raised it deliberately and its message
  // was written for the caller. Anything else is unexpected, and those messages
  // carry internals — filesystem paths, SQL — that should not cross the wire in
  // production. Outside production keep them: they are how you debug.
  const status = err.status || 500;
  const message =
    status < 500 || nodeEnv !== "production"
      ? err.message || "Internal Server Error"
      : "Internal Server Error";
  res.status(status).json({ error: message });
});

server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
