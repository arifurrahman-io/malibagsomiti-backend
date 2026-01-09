const express = require("express");
const router = express.Router();
const {
  createTransaction,
  getMemberTransactions,
} = require("../controllers/transactionController");
const { protect, authorize } = require("../middleware/authMiddleware");

// মেম্বারদের জন্য নিজস্ব ডাটা দেখার রাউট (GET)
router.get("/my-history", protect, getMemberTransactions);

// এডমিনদের জন্য ট্রাঞ্জেকশন তৈরির রাউট (POST)
router.post("/", protect, authorize("admin", "super-admin"), createTransaction);

module.exports = router;
