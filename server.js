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

const app = express();

// 3. Ensure Upload Directories Exist
const uploadDir = path.join(__dirname, "uploads/documents");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 4. Global Middleware
app.use(
  helmet({
    // Crucial for viewing PDFs/Images in the browser
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(cors()); // এটি সব ধরণের অরিজিন এলাউ করবে

app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 5. Development Logging
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// 6. Static File Serving
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// 7. API Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/members", require("./routes/memberRoutes"));

/**
 * 🚀 NEW: Society Bank Account Registry
 * Handles bank names, account numbers, types, and holders.
 */
app.use("/api/bank-accounts", require("./routes/bankRoutes")); // <--- ADDED THIS LINE

app.use("/api/finance/categories", require("./routes/categoryRoutes"));
app.use("/api/finance/transaction", require("./routes/transactionRoutes"));
app.use("/api/finance", require("./routes/financeRoutes"));

// 8. Root Route
app.get("/", (req, res) => {
  res.send("Malibag Teachers Society API is running...");
});

// 9. Centralized Error Handler
app.use(errorHandler);

// 10. Start Server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`
    🚀 Server running in ${process.env.NODE_ENV} mode on port ${PORT}
    📧 Email Service Ready
    ⏰ Cron Jobs Scheduled
    📂 Static Uploads: ${uploadDir}
    🏦 Bank Registry: /api/bank-accounts
  `);
});

// Handle Unhandled Rejections
process.on("unhandledRejection", (err) => {
  console.error(`Error: ${err.message}`);
});
