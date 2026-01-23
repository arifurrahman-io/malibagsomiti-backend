const Notification = require("../models/Notification");

/**
 * Log a notification for a user
 */
exports.createNotification = async (req, res) => {
  try {
    const { userId, title, body, type, referenceId } = req.body;

    const notification = await Notification.create({
      userId,
      title,
      body,
      type: type || "GENERAL",
      referenceId: referenceId || null,
      delivered: false,
      read: false,
      sentAt: new Date(),
    });

    res.status(201).json({ success: true, data: notification });
  } catch (err) {
    console.error("Notification Creation Failed:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Get notifications for a user (paginated)
 */
exports.getUserNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const userId = req.user.id;

    const notifications = await Notification.find({ userId })
      .sort({ sentAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await Notification.countDocuments({ userId });

    res
      .status(200)
      .json({ success: true, total, page: Number(page), notifications });
  } catch (err) {
    console.error("Fetch Notifications Failed:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Mark a notification as read
 */
exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await Notification.findOneAndUpdate(
      { _id: id, userId: req.user.id },
      { read: true, readAt: new Date() },
      { new: true },
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    res.status(200).json({ success: true, data: notification });
  } catch (err) {
    console.error("Mark Read Failed:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};
