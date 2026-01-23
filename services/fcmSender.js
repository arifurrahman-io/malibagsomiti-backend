const admin = require("../config/firebase");
const User = require("../models/User");
const Notification = require("../models/Notification");

/**
 * Send push notification to a user (ALL devices)
 */
exports.sendPushToUser = async ({
  userId,
  title,
  body,
  data = {},
  type = "GENERAL",
  referenceId = null,
}) => {
  // 1️⃣ Get user
  const user = await User.findById(userId);

  if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
    throw new Error("No FCM tokens registered for user");
  }

  // 2️⃣ Prepare message
  const message = {
    tokens: user.fcmTokens,
    notification: {
      title,
      body,
    },
    data: {
      type,
      referenceId: referenceId ? String(referenceId) : "",
      click_action: "FLUTTER_NOTIFICATION_CLICK",
      ...data,
    },
    android: {
      priority: "high",
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
        },
      },
    },
  };

  // 3️⃣ Send message
  const response = await admin.messaging().sendMulticast(message);

  // 4️⃣ Handle invalid tokens
  const validTokens = [];
  response.responses.forEach((res, index) => {
    if (res.success) {
      validTokens.push(user.fcmTokens[index]);
    }
  });

  // 5️⃣ Remove invalid tokens automatically
  if (validTokens.length !== user.fcmTokens.length) {
    user.fcmTokens = validTokens;
    await user.save();
  }

  // 6️⃣ Save notification history
  await Notification.create({
    userId,
    title,
    body,
    type,
    referenceId,
    delivered: response.successCount > 0,
    sentAt: new Date(),
    read: false,
  });

  return {
    success: true,
    sent: response.successCount,
    failed: response.failureCount,
  };
};
