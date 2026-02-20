import { deleteField, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { app, db } from "./firebaseClient";

let onMessageBound = false;

const toLowerText = (value) =>
  value === null || value === undefined ? "" : value.toString().trim().toLowerCase();

const isMonitorProfile = (profile) => {
  const role = toLowerText(profile?.role);
  const accountType = toLowerText(profile?.accountType);
  return (
    role === "monitor" ||
    role === "monitora" ||
    accountType === "monitor" ||
    accountType === "monitora"
  );
};

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
      new Notification(title, {
        body,
        icon: "/logo.svg",
      });
    } catch (error) {
      // ignore foreground notification errors
    }
  });
};

export const clearWebPushTokenForUser = async (uid) => {
  if (!uid) return;
  const userRef = doc(db, "users", uid);
  await setDoc(
    userRef,
    {
      pushNotifications: {
        web: {
          token: deleteField(),
          enabled: false,
          updatedAt: serverTimestamp(),
        },
      },
    },
    { merge: true }
  );
};

export const setupStudentWebPush = async ({ uid, profile }) => {
  if (!uid || !profile || isMonitorProfile(profile)) {
    return { ok: false, reason: "not-student" };
  }

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

  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch (error) {
      return { ok: false, reason: "permission-error" };
    }
  }

  if (Notification.permission !== "granted") {
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

  return { ok: true, token };
};
