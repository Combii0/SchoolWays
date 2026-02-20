import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { app, db } from "./firebaseClient";

let onMessageBound = false;

const registerServiceWorker = async () => {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  try {
    return await navigator.serviceWorker.register("/sw/firebase-messaging", {
      scope: "/",
    });
  } catch (error) {
    return null;
  }
};

const bindForegroundNotifications = (messaging) => {
  if (onMessageBound) return;
  onMessageBound = true;

  onMessage(messaging, (payload) => {
    if (typeof window === "undefined") return;
    if (Notification.permission !== "granted") return;

    const title = payload?.data?.title || "SchoolWays";
    const body = payload?.data?.body || "Tienes una nueva notificacion de ruta.";

    try {
      window.dispatchEvent(
        new CustomEvent("schoolways:push-foreground", {
          detail: { title, body },
        })
      );
    } catch (error) {
      // ignore foreground notification errors
    }
  });
};

export const getBrowserNotificationPermission = () => {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  return Notification.permission;
};

export const setupWebPushForUser = async ({
  uid,
  requestPermission = true,
  existingToken = "",
  existingEnabled = false,
}) => {
  if (!uid) return { ok: false, reason: "missing-uid" };
  if (typeof window === "undefined") {
    return { ok: false, reason: "no-window" };
  }

  const messagingSupported = await isSupported().catch(() => false);
  if (!messagingSupported) {
    return { ok: false, reason: "unsupported" };
  }

  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) {
    return { ok: false, reason: "missing-vapid" };
  }

  const serviceWorkerRegistration = await registerServiceWorker();
  if (!serviceWorkerRegistration) {
    return { ok: false, reason: "sw-failed" };
  }

  if (getBrowserNotificationPermission() === "default" && requestPermission) {
    try {
      await Notification.requestPermission();
    } catch (error) {
      return { ok: false, reason: "permission-error" };
    }
  }

  if (getBrowserNotificationPermission() === "default" && !requestPermission) {
    return { ok: false, reason: "permission-pending" };
  }

  if (getBrowserNotificationPermission() !== "granted") {
    return { ok: false, reason: "permission-denied" };
  }

  const messaging = getMessaging(app);
  bindForegroundNotifications(messaging);

  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration,
  }).catch(() => "");

  if (!token) {
    return { ok: false, reason: "token-failed" };
  }

  const normalizedExistingToken =
    typeof existingToken === "string" ? existingToken.trim() : "";
  if (existingEnabled && normalizedExistingToken && normalizedExistingToken === token) {
    return { ok: true, token, wrote: false };
  }

  const userRef = doc(db, "users", uid);
  await setDoc(
    userRef,
    {
      pushNotifications: {
        web: {
          token,
          enabled: true,
          updatedAt: serverTimestamp(),
          userAgent:
            typeof navigator !== "undefined" ? navigator.userAgent || null : null,
        },
      },
    },
    { merge: true }
  );

  return { ok: true, token, wrote: true };
};
