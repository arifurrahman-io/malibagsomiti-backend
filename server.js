const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");
const connectDB = require("./config/db");
const errorHandler = require("./middleware/errorMiddleware");
require("./utils/cronJobs");

// 1. Load Environment Variables
dotenv.config();

// 2. Connect to Database
connectDB();

/**
 * 3. Initialize Firebase Admin SDK
 * Importing this file triggers the admin.initializeApp() logic
 * required for Push Notifications.
 */
require("./config/firebase");

// 4. Load Background Tasks (Cron Jobs)
require("./utils/cronJobs");

const app = express();

/**
 * 3. Directory & File Management
 * Ensure all necessary upload directories are present before server starts.
 */
const directories = [
  path.join(__dirname, "uploads"),
  path.join(__dirname, "uploads/documents"),
];

directories.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📂 Created Directory: ${dir}`);
  }
});

/**
 * 4. Global Security & Optimization Middleware
 */
app.use(
  helmet({
    // Essential for serving static PDFs/Images to mobile apps or browsers
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(cors()); // Allow cross-origin requests from the mobile app
app.use(compression()); // Compress responses for better performance
app.use(express.json()); // Body parser for JSON
app.use(express.urlencoded({ extended: true }));

// 5. Development Logging
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

/**
 * 6. Static File Serving
 * Expose the uploads folder to access member documents and transaction slips.
 */
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/**
 * 7. API Routes Mapping [cite: 2025-10-11, 2026-01-10]
 * Society Management & Financial Modules
 */
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/members", require("./routes/memberRoutes"));
app.use("/api/bank-accounts", require("./routes/bankRoutes"));

// Financial & Treasury Modules
app.use("/api/finance/categories", require("./routes/categoryRoutes"));
app.use("/api/finance/transaction", require("./routes/transactionRoutes"));

/**
 * 🚀 IMPORTANT: Finance Routes Registry
 * This file handles fine-settings, deposits, and member summaries.
 * Full Path Example: /api/finance/fine-settings
 */
app.use("/api/finance", require("./routes/financeRoutes"));

/**
 * 8. Server Health & Root Access
 */
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Malibagh Somiti API is operational",
    timestamp: new Date().toISOString(),
  });
});

/**
 * 9. Handle Undefined Routes (404)
 * If no route matches, return a professional 404 response.
 */
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: `Resource not found - ${req.originalUrl}`,
  });
});

// 10. Centralized Error Handler
app.use(errorHandler);

// 11. Start Server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`
    🚀 SERVER READY
    -----------------------------------------
    Mode     : ${process.env.NODE_ENV}
    Port     : ${PORT}
    Logs     : ${
      process.env.NODE_ENV === "development" ? "Morgan Dev" : "Production"
    }
    Database : MongoDB Connected
    Storage  : /uploads/documents
    Fine Eng : /api/finance/fine-settings
    -----------------------------------------
  `);
});

// Handle Unhandled Promise Rejections
process.on("unhandledRejection", (err) => {
  console.error(`🔴 Unhandled Rejection: ${err.message}`);
  server.close(() => process.exit(1));
});
