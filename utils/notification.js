const admin = require("firebase-admin");

/**
 * Sends push notifications via Firebase
 * @param {Array} tokens - Array of FCM registration tokens
 * @param {Object} payload - { title, body, data }
 */
exports.sendPushNotification = async (tokens, payload) => {
  // Filter out null or empty tokens to prevent Firebase errors
  const validTokens = tokens.filter((token) => token && token !== "");
  if (validTokens.length === 0) return;

  const message = {
    notification: {
      title: payload.title,
      body: payload.body,
    },
    android: {
      priority: "high", // ✅ Required for background reliability
      notification: {
        channelId: "default", // ✅ Required for system tray visibility
        sound: "default",
      },
    },
    data: payload.data || {},
    tokens: validTokens,
  };

  try {
    // sendEachForMulticast is the modern standard for batch notifications
    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`Successfully sent ${response.successCount} notifications.`);

    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(validTokens[idx]);
        }
      });
      console.warn(`Failed tokens: ${failedTokens.length}`);
    }
  } catch (error) {
    console.error("Firebase Multicast Error:", error);
  }
};
