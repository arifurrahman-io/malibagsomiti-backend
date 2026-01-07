const express = require("express");
const router = express.Router();
const {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} = require("../controllers/categoryController");

// Middleware for authentication and authorization
const { protect, authorize } = require("../middleware/authMiddleware");

/**
 * @route   /api/finance/categories
 * @access  Private
 */
router
  .route("/")
  .get(protect, getCategories) // All authenticated users can view categories
  .post(protect, authorize("admin", "super-admin"), createCategory); // Only admins can create

/**
 * @route   /api/finance/categories/:id
 * @access  Private/Admin
 */
router
  .route("/:id")
  .put(protect, authorize("admin", "super-admin"), updateCategory) // Edit existing categories
  .delete(protect, authorize("super-admin"), deleteCategory); // Only super-admin can delete

module.exports = router;
