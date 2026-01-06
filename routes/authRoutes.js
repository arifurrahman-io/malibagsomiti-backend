const express = require("express");
const router = express.Router();
const {
  login,
  updateProfile,
  updatePassword,
} = require("../controllers/authController");
const { protect } = require("../middleware/authMiddleware");

// Public route
router.post("/login", login);

// Protected routes (Require login)
router.put("/update-profile", protect, updateProfile);
router.put("/update-password", protect, updatePassword);

module.exports = router;
