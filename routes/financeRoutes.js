const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const {
  processDeposit,
  addExpense,
  addInvestment,
  recordInvestmentProfit,
  getAdminSummary,
  getBranchSummary,
  checkPayments,
  getAllInvestments,
  getInvestmentHistory,
  getInvestmentById,
  updateInvestment,
  deleteInvestment,
  downloadInvestmentReport,
  getAllTransactions,
  getMemberHistory,
  getMemberSummary,
} = require("../controllers/financeController");

const { protect, authorize } = require("../middleware/authMiddleware");

/**
 * 1. Multer Storage Configuration
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/documents/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const extension = path.extname(file.originalname).toLowerCase();
    cb(null, file.fieldname + "-" + uniqueSuffix + extension);
  },
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const isExtAllowed = allowedTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    if (isExtAllowed) return cb(null, true);
    cb(new Error("Only .png, .jpg, .jpeg and .pdf files are allowed!"));
  },
});

// All finance routes require base authentication
router.use(protect);

/**
 * @section Administrative Transactions
 */
router.post("/deposit", authorize("admin", "super-admin"), processDeposit);
router.post("/expense", authorize("admin", "super-admin"), addExpense);
router.post(
  "/investment",
  authorize("admin", "super-admin"),
  upload.single("legalDocs"),
  addInvestment
);

/**
 * @section Project & Investment Management
 */
router.get("/investments", getAllInvestments);
router.get("/investment/:id", getInvestmentById);
router.get(
  "/investment/:id/history",
  authorize("admin", "super-admin"),
  getInvestmentHistory
);
router.post(
  "/investment/:id/profit",
  authorize("admin", "super-admin"),
  recordInvestmentProfit
);
router.get(
  "/investment/:id/report",
  authorize("admin", "super-admin"),
  downloadInvestmentReport
);

/**
 * @section Analytics & Summaries
 */
router.get("/summary", getAdminSummary);
router.get(
  "/summary/:branch",
  authorize("admin", "super-admin"),
  getBranchSummary
);
router.get("/member-summary", getMemberSummary);
router.get("/check-payments", authorize("admin", "super-admin"), checkPayments);

/**
 * @section Transaction History (Order Matters!)
 * 🚀 Fixed: Static routes must come BEFORE parameterized routes to avoid 500 errors.
 */

// 1. Admin/Super-Admin Full Audit
router.get(
  "/all-transactions",
  authorize("admin", "super-admin"),
  getAllTransactions
);

// 2. Personal History (For the logged-in Member)
// Express will check this first when the URL is /history/me
router.get("/history/me", getMemberHistory);

// 3. Member Lookup (For Admins to see specific user history)
// Express will check this if the URL is /history/65a123...
router.get("/history/:id", authorize("admin", "super-admin"), getMemberHistory);

/**
 * @section Super-Admin Project Management
 */
router.put(
  "/investment/:id",
  authorize("super-admin"),
  upload.single("legalDocs"),
  updateInvestment
);
router.delete("/investment/:id", authorize("super-admin"), deleteInvestment);

module.exports = router;
