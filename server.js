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
// Note: Ensure your config/db.js uses serverSelectionTimeoutMS to prevent crash loops
connectDB();

const app = express();

// 3. Ensure Upload Directories Exist for Legal Documents
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

// Dynamic CORS configuration
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);

app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 5. Development Logging
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// 6. Static File Serving (Root level access)
// Enables access via http://localhost:5000/uploads/documents/filename.pdf
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// 7. API Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/members", require("./routes/memberRoutes"));
app.use("/api/finance", require("./routes/financeRoutes"));

// 8. Root Route
app.get("/", (req, res) => {
  res.send("Malibag Teachers Society API is running...");
});

// 9. Centralized Error Handler (Must be last)
app.use(errorHandler);

// 10. Start Server with enhanced logging
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`
    🚀 Server running in ${process.env.NODE_ENV} mode on port ${PORT}
    📧 Email Service Ready
    ⏰ Cron Jobs Scheduled
    📂 Static Uploads: ${uploadDir}
  `);
});

/**
 * Handle Unhandled Rejections (like MongoDB ETIMEOUT)
 * This prevents nodemon from crashing completely during network flickers.
 */
process.on("unhandledRejection", (err) => {
  console.error(`Error: ${err.message}`);
  // Keep the server running but log the error
});
