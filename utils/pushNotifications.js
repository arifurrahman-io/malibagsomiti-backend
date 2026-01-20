import messaging from "@react-native-firebase/messaging";
import axiosInstance from "../api/axiosInstance";

export const requestUserPermission = async () => {
  const authStatus = await messaging().requestPermission();
  const enabled =
    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
    authStatus === messaging.AuthorizationStatus.PROVISIONAL;

  if (enabled) {
    const token = await messaging().getToken();
    console.log("FCM Token:", token);
    return token;
  }
  return null;
};
