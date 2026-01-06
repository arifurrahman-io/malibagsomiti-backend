const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const {
  processDeposit,
  addExpense,
  addInvestment,
  recordInvestmentProfit,
  getSocietySummary,
  getAdminSummary,
  getBranchSummary,
  checkPayments,
  getAllInvestments,
  getInvestmentHistory,
  updateInvestment,
  deleteInvestment,
  downloadInvestmentReport, // NEW: For the printable PDF report
  getAllTransactions,
} = require("../controllers/financeController");

const { protect, authorize } = require("../middleware/authMiddleware");

/**
 * 1. Multer Storage Configuration
 * Ensures files have correct extensions to prevent 404 errors on download
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

// All finance routes require authentication
router.use(protect);

/**
 * @section Administrative Transactions
 * Restricted to Admin and Super-Admin roles.
 */

// Deposits: Process monthly collections with period tracking
router.post("/deposit", authorize("admin", "super-admin"), processDeposit);

// Expenses: Record society spending
router.post("/expense", authorize("admin", "super-admin"), addExpense);

// Investments: Record new project investments with legal document upload
router.post(
  "/investment",
  authorize("admin", "super-admin"),
  upload.single("legalDocs"), // MUST match frontend key
  addInvestment
);

// History: View ledger for a specific project
router.get(
  "/investment/:id/history",
  authorize("admin", "super-admin"),
  getInvestmentHistory
);

// Monthly Profit/Expense: Logic for adding returns or costs to a project
router.post(
  "/investment/:id/profit",
  authorize("admin", "super-admin"),
  recordInvestmentProfit
);

// NEW: Report: Download printable investment financial summary

router.get(
  "/investment/:id/report",
  authorize("admin", "super-admin"),
  downloadInvestmentReport
);

/**
 * @section Dashboard & Analytics
 */

// Global Admin Summary (Powers the "Active Capital" and "Society Fund" cards)
router.get("/summary", authorize("admin", "super-admin"), getAdminSummary);

// Member Personal Summary for teacher-specific views
router.get(
  "/member-summary",
  authorize("member", "admin", "super-admin"),
  getSocietySummary
);

// Payment check to prevent double entries in the collection list
router.get("/check-payments", authorize("admin", "super-admin"), checkPayments);

// Branch-specific financial analytics
router.get(
  "/summary/:branch",
  authorize("admin", "super-admin"),
  getBranchSummary
);

// List of all projects for the Portfolio grid
router.get(
  "/investments",
  authorize("admin", "super-admin"),
  getAllInvestments
);

/**
 * @section Super-Admin Management
 */

// Update Project: Modify capital or upload new legal docs
router.put(
  "/investment/:id",
  authorize("super-admin"),
  upload.single("legalDocs"),
  updateInvestment
);

// Delete Project: Remove project and associated local documents
router.delete("/investment/:id", authorize("super-admin"), deleteInvestment);

router.get(
  "/all-transactions",
  authorize("admin", "super-admin"),
  getAllTransactions
);

module.exports = router;
