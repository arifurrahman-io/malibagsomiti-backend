const express = require("express");
const router = express.Router();
const {
  getAllMembers,
  createMember,
  getMemberProfile,
  updateMember,
  toggleStatus,
  deleteMember,
} = require("../controllers/memberController");
const { protect, authorize } = require("../middleware/authMiddleware");

// All member-related operations require a valid JWT session
router.use(protect);

/**
 * @desc    Get detailed member profile + Personal Financial Summary
 * @route   GET /api/members/profile/:id?
 * @access  Protected (Member/Admin)
 * 🚀 Note: The ':id?' parameter is now optional.
 * If omitted, the controller uses the logged-in user's ID.
 */
// routes/memberRoutes.js
// Define the specific ID route first, then the base route
router.get("/profile/:id", getMemberProfile);
router.get("/profile", getMemberProfile);

/**
 * @section Administrative Governance
 * @access  Restricted to Admin & Super-Admin roles
 */

// Bulk member registry management
router
  .route("/")
  .get(authorize("admin", "super-admin"), getAllMembers) // Fetch searchable member directory
  .post(authorize("admin", "super-admin"), createMember); // Register new society member

// Specific member record modifications
router
  .route("/:id")
  .put(authorize("admin", "super-admin"), updateMember) // Update verified credentials or share units
  .patch(authorize("admin", "super-admin"), toggleStatus) // Deactivate/Reactivate account registry
  .delete(authorize("super-admin"), deleteMember); // Permanent removal (Super-Admin only)

module.exports = router;
