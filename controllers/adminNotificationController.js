const { sendPushToUser } = require("../services/fcmSender");

exports.notifyUser = async (req, res) => {
  try {
    const { userId, title, body, type, referenceId } = req.body;

    const result = await sendPushToUser({
      userId,
      title,
      body,
      type,
      referenceId,
    });

    res.status(200).json({
      success: true,
      message: "Notification sent",
      result,
    });
  } catch (error) {
    console.error("FCM Send Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
