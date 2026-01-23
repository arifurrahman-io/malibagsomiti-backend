const admin = require("../config/firebase");
const Notification = require("../models/Notification");

exports.sendPushNotification = async (tokens, payload, userId) => {
  const validTokens = tokens.filter(Boolean);
  if (!validTokens.length) return;

  const message = {
    android: { priority: "high" },
    data: {
      type: payload.type || "GENERAL",
      title: payload.title,
      body: payload.body,
      referenceId: payload.referenceId || "",
      timestamp: Date.now().toString(),
    },
    tokens: validTokens,
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(message);

    // Log history for EACH token
    const notifications = validTokens.map((token) => ({
      user: userId,
      fcmToken: token,
      title: payload.title,
      body: payload.body,
      type: payload.type || "GENERAL",
      referenceId: payload.referenceId || null,
      delivered: true, // can be updated later if delivery fails
      sentAt: new Date(),
    }));

    await Notification.insertMany(notifications);

    // Cleanup invalid tokens (as before)
    const invalidTokens = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const code = resp.error?.code;
        if (
          code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token"
        ) {
          invalidTokens.push(validTokens[idx]);
        }
      }
    });

    if (invalidTokens.length) {
      await User.updateMany(
        { fcmTokens: { $in: invalidTokens } },
        { $pull: { fcmTokens: { $in: invalidTokens } } },
      );
    }

    console.log(
      `Push sent: ${response.successCount} success, ${response.failureCount} failed`,
    );
  } catch (error) {
    console.error("FCM Send Error:", error);
  }
};
