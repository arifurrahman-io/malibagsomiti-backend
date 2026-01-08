// routes/bankRoutes.js
const express = require("express");
const router = express.Router();
const {
  addBankAccount,
  getBankAccounts,
  updateBankAccount,
  deleteBankAccount,
  transferBalance,
} = require("../controllers/bankAccountController");
const { protect, authorize } = require("../middleware/authMiddleware");

// All routes below this require a valid login token
router.use(protect);

/**
 * @route   GET /api/bank-accounts
 * @desc    Fetch all bank accounts. Members can view to see global society liquidity.
 * @access  Private (Member, Admin, Super-Admin)
 * * @route   POST /api/bank-accounts
 * @desc    Add a new treasury account.
 * @access  Private (Admin, Super-Admin)
 */
router
  .route("/")
  .get(getBankAccounts) // 🔥 REMOVED authorize() to allow members read-only access for the global dashboard
  .post(authorize("admin", "super-admin"), addBankAccount);

/**
 * @route   POST /api/bank-accounts/transfer
 * @desc    Execute an internal fund transfer between two society accounts.
 * @access  Private (Admin, Super-Admin)
 */
router.post("/transfer", authorize("admin", "super-admin"), transferBalance);

/**
 * @route   PUT /api/bank-accounts/:id
 * @route   DELETE /api/bank-accounts/:id
 * @access  Private (Admin, Super-Admin)
 */
router
  .route("/:id")
  .put(authorize("admin", "super-admin"), updateBankAccount)
  .delete(authorize("admin", "super-admin"), deleteBankAccount);

module.exports = router;
