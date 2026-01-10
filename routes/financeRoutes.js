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
  updateInvestment,
  deleteInvestment,
  downloadInvestmentReport,
  getAllTransactions,
  getMemberHistory,
  getMemberSummary, // Personalized registry list for members
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
 * Strictly restricted to Admin/Super-Admin roles.
 */

// Monthly Share Collections
router.post("/deposit", authorize("admin", "super-admin"), processDeposit);

// Society Expenditures
router.post("/expense", authorize("admin", "super-admin"), addExpense);

// New Project Registry
router.post(
  "/investment",
  authorize("admin", "super-admin"),
  upload.single("legalDocs"),
  addInvestment
);

// Project Ledger Access
router.get(
  "/investment/:id/history",
  authorize("admin", "super-admin"),
  getInvestmentHistory
);

// Project Yield/ROI Entry
router.post(
  "/investment/:id/profit",
  authorize("admin", "super-admin"),
  recordInvestmentProfit
);

// Printable Audit Reports for Projects
router.get(
  "/investment/:id/report",
  authorize("admin", "super-admin"),
  downloadInvestmentReport
);

/**
 * @section Dashboard & Analytics
 * Shared routes that allow all users to view global metrics.
 */

// 🔥 GLOBAL SUMMARY: Accessible to all roles so Society Net Liquidity shows correctly [cite: 2025-10-11]
router.get("/summary", getAdminSummary);

// PERSONAL REGISTRY: Fetches user-specific history for the dashboard sidebar
router.get("/member-summary", getMemberSummary);

// Registry Integrity Check
router.get("/check-payments", authorize("admin", "super-admin"), checkPayments);

// Portfolio Overview (Visible to everyone for transparency)
router.get("/investments", getAllInvestments);

// Regional Analytics
router.get(
  "/summary/:branch",
  authorize("admin", "super-admin"),
  getBranchSummary
);

router.get("/history/:id", getMemberHistory);

/**
 * @section Super-Admin Management & Full Audit
 */

// Project Updates & Legal Doc Modifications
router.put(
  "/investment/:id",
  authorize("super-admin"),
  upload.single("legalDocs"),
  updateInvestment
);

// Permanent Project Deletion
router.delete("/investment/:id", authorize("super-admin"), deleteInvestment);

// Full Historical Registry (Admin Audit View)
router.get(
  "/all-transactions",
  authorize("admin", "super-admin"),
  getAllTransactions
);

// Member-Specific History Lookup

module.exports = router;
