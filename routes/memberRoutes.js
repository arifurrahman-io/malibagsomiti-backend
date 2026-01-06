const express = require("express");
const router = express.Router();
const {
  getAllMembers,
  createMember,
  getMemberProfile,
  updateMember,
  toggleStatus,
  deleteMember, // Newly added from controller
} = require("../controllers/memberController");
const { protect, authorize } = require("../middleware/authMiddleware");

// All member routes require login
router.use(protect);

/**
 * @desc    Get detailed member profile + Financial Summary
 * @route   GET /api/members/profile/:id
 * @access  Protected (All logged-in users)
 */
router.get("/profile/:id", getMemberProfile);

/**
 * @desc    Admin & Super Admin Section
 * @access  Restricted
 */
router
  .route("/")
  .get(authorize("admin", "super-admin"), getAllMembers) // Fetch member list
  .post(authorize("admin", "super-admin"), createMember); // Register new member

router
  .route("/:id")
  .put(authorize("admin", "super-admin"), updateMember) // Update member details
  .patch(authorize("super-admin"), toggleStatus) // Toggle active/inactive status
  .delete(authorize("super-admin"), deleteMember); // Permanently remove member

module.exports = router;
