const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const http = require("http");
const { Server } = require("socket.io");
const { verifyJwt } = require("./utils/jwt");
const { port, nodeEnv, corsOrigin } = require("./config/env");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const categoryRoutes = require("./routes/categories");
const productRoutes = require("./routes/products");
const orderRoutes = require("./routes/orders");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: corsOrigin, credentials: true },
});

// Make io available inside route handlers (req.app.get("io"))
app.set("io", io);

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
  // console.log("socket.connection", socket);
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
app.use("/api/orders", orderRoutes);

// 404 handler
app.use((req, res, next) => {
  console.log("404", req?.url);
  res.status(404).json({ error: "Not Found" });
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err); // In production consider structured logging
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "Internal Server Error" });
});

server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
