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

// All routes require authentication
router.use(protect);

/**
 * @section User / Member Self-Access
 * @desc    Get profile for self or specific ID
 * @route   GET /api/members/profile OR /api/members/profile/:id
 */
// 🔥 Use two separate routes instead of the optional '?' which causes the crash
router.get("/profile", getMemberProfile);
router.get("/profile/:id", getMemberProfile);

/**
 * @section Administrative Governance
 * @access  Restricted to Admin & Super-Admin roles [cite: 2025-10-11]
 */

// 1. Bulk Member Management
router
  .route("/")
  .get(authorize("admin", "super-admin"), getAllMembers)
  .post(authorize("admin", "super-admin"), createMember);

// 2. Standard CRUD for Single Member Records
router
  .route("/:id")
  .get(authorize("admin", "super-admin"), getMemberProfile) // Fixes your 404 for Admin viewing Profile
  .put(authorize("admin", "super-admin"), updateMember)
  .patch(authorize("admin", "super-admin"), toggleStatus)
  .delete(authorize("super-admin"), deleteMember);

module.exports = router;
