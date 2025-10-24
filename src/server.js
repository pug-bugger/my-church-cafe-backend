const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const { port, nodeEnv } = require("./config/env");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const categoryRoutes = require("./routes/categories");
const productRoutes = require("./routes/products");
const orderRoutes = require("./routes/orders");

const app = express();

// Middleware
app.use(cors({ origin: true, credentials: true }));
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
  res.status(404).json({ error: "Not Found" });
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err); // In production consider structured logging
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "Internal Server Error" });
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
