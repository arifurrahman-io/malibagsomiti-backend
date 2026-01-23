const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  createNotification,
  getUserNotifications,
  markAsRead,
} = require("../controllers/notificationController");

// All routes require authentication
router.use(protect);

router.post("/", createNotification); // optional, used by backend services
router.get("/", getUserNotifications); // get current user's notifications
router.patch("/:id/read", markAsRead); // mark a notification as read

module.exports = router;
