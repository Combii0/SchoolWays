import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { app, auth } from "./firebaseClient";

let onMessageBound = false;

const getUserAgent = () =>
  typeof navigator === "undefined" ? "" : navigator.userAgent || "";

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

    const title =
      payload?.data?.title ||
      payload?.notification?.title ||
      "SchoolWays";
    const body =
      payload?.data?.body ||
      payload?.notification?.body ||
      "Tienes una nueva notificacion de ruta.";

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

export const isAppleMobileBrowser = () => {
  const ua = getUserAgent();
  if (!ua) return false;
  return /iPhone|iPad|iPod/i.test(ua);
};

export const isStandaloneWebApp = () => {
  if (typeof window === "undefined") return false;
  const byMatchMedia =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  const byNavigator = typeof navigator !== "undefined" && navigator.standalone === true;
  return Boolean(byMatchMedia || byNavigator);
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

  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid !== uid) {
    return { ok: false, reason: "auth-mismatch" };
  }

  const idToken = await currentUser.getIdToken().catch(() => "");
  if (!idToken) {
    return { ok: false, reason: "id-token-failed" };
  }

  const registerResponse = await fetch("/api/push/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      token,
      userAgent:
        typeof navigator !== "undefined" ? navigator.userAgent || null : null,
    }),
  }).catch(() => null);

  if (!registerResponse?.ok) {
    return { ok: false, reason: "register-failed" };
  }

  return { ok: true, token, wrote: true };
};
