// routes/bankRoutes.js
const express = require("express");
const router = express.Router();
const {
  addBankAccount,
  getBankAccounts,
  updateBankAccount,
  deleteBankAccount,
  transferBalance, // 🔥 Import this
} = require("../controllers/bankAccountController");
const { protect, authorize } = require("../middleware/authMiddleware");

router.use(protect);

router
  .route("/")
  .get(authorize("admin", "super-admin"), getBankAccounts)
  .post(authorize("admin", "super-admin"), addBankAccount);

// 🔥 PLACE THIS ABOVE /:id
router.post("/transfer", authorize("admin", "super-admin"), transferBalance);

router
  .route("/:id")
  .put(authorize("admin", "super-admin"), updateBankAccount)
  .delete(authorize("admin", "super-admin"), deleteBankAccount);

module.exports = router;
