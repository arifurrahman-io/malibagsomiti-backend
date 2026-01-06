const express = require("express");
const router = express.Router();
const {
  getAllMembers, // Ensure this matches the controller export name
  createMember, // Ensure this matches the controller export name
  getMemberProfile, // This is likely the cause of the error
  updateMember,
  toggleStatus,
} = require("../controllers/memberController");
const { protect, authorize } = require("../middleware/authMiddleware");

// All member routes require login
router.use(protect);

// GET personal profile
// Check if getMemberProfile is correctly imported above
router.get("/profile/:id", getMemberProfile);

// Admin & Super Admin Only Routes
router
  .route("/")
  .get(authorize("admin", "super-admin"), getAllMembers)
  .post(authorize("admin", "super-admin"), createMember);

router
  .route("/:id")
  .put(authorize("admin", "super-admin"), updateMember)
  .patch(authorize("super-admin"), toggleStatus);

module.exports = router;
