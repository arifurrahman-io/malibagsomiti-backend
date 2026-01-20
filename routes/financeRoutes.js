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
  updateFineSettings,
  getFineSettings,
  getDefaulterList,
} = require("../controllers/financeController");

const { protect, authorize } = require("../middleware/authMiddleware");
const fs = require("fs");
const dir = "./uploads/documents/";

// Ensure upload directory exists
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

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
      path.extname(file.originalname).toLowerCase(),
    );
    if (isExtAllowed) return cb(null, true);
    cb(new Error("Only .png, .jpg, .jpeg and .pdf files are allowed!"));
  },
});

// All finance routes require base authentication
router.use(protect);

/**
 * @section 1. Administrative Transactions
 */
router.post("/deposit", authorize("admin", "super-admin"), processDeposit);
router.post("/expense", authorize("admin", "super-admin"), addExpense);
router.post(
  "/investment",
  authorize("admin", "super-admin"),
  upload.single("legalDocs"),
  addInvestment,
);

/**
 * @section 2. Defaulter & Fine Management
 * জরিমানার হার এবং গ্রেস পিরিয়ড নিয়ন্ত্রণের জন্য [cite: 2025-10-11]
 */
router
  .route("/fine-settings")
  .get(authorize("admin", "super-admin"), getFineSettings)
  .put(authorize("super-admin"), updateFineSettings);

router.get("/defaulters", authorize("admin", "super-admin"), getDefaulterList);

/**
 * @section 3. Project & Investment Management
 */
router.get("/investments", getAllInvestments);
router.get("/investment/:id", getInvestmentById);
router.get(
  "/investment/:id/history",
  authorize("admin", "super-admin"),
  getInvestmentHistory,
);
router.post(
  "/investment/:id/profit",
  authorize("admin", "super-admin"),
  recordInvestmentProfit,
);
router.get(
  "/investment/:id/report",
  authorize("admin", "super-admin"),
  downloadInvestmentReport,
);

/**
 * @section 4. Analytics & Summaries
 */
router.get("/summary", getAdminSummary);
router.get(
  "/summary/:branch",
  authorize("admin", "super-admin"),
  getBranchSummary,
);
router.get("/member-summary", getMemberSummary); // মেম্বার ড্যাশবোর্ডে জরিমানার জন্য
router.get("/check-payments", authorize("admin", "super-admin"), checkPayments);

/**
 * @section 5. Transaction History (Ordering is Critical)
 */
router.get(
  "/all-transactions",
  authorize("admin", "super-admin"),
  getAllTransactions,
);
router.get("/history/me", getMemberHistory);
router.get("/history/:id", authorize("admin", "super-admin"), getMemberHistory);

/**
 * @section 2. Defaulter & Fine Management
 */
// নতুন রাউট যোগ করুন (Waive Fine এর জন্য) [cite: 2026-01-15]
router.post(
  "/waive-fine",
  authorize("admin", "super-admin"),
  require("../controllers/financeController").waiveFinePartial,
);

/**
 * @section 6. Super-Admin Restricted Management
 */
router.put(
  "/investment/:id",
  authorize("super-admin"),
  upload.single("legalDocs"),
  updateInvestment,
);
router.delete("/investment/:id", authorize("super-admin"), deleteInvestment);

module.exports = router;
