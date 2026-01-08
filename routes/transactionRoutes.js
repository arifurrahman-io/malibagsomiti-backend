const express = require("express");
const router = express.Router();
const { createTransaction } = require("../controllers/transactionController"); // 🔥 Ensure this exists
const { protect, authorize } = require("../middleware/authMiddleware");

/**
 * @route   POST /api/finance/transaction
 * @desc    Create a manual deposit or expense entry (Direct Entry)
 * @access  Private (Admin/Super-Admin)
 */
router.post("/", protect, authorize("admin", "super-admin"), createTransaction);

module.exports = router;
