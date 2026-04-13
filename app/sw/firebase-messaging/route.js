import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET() {
  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
  };

  const script = `
importScripts("https://www.gstatic.com/firebasejs/12.8.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.8.0/firebase-messaging-compat.js");

firebase.initializeApp(${JSON.stringify(firebaseConfig)});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title =
    payload?.data?.title ||
    payload?.notification?.title ||
    "SchoolWays";
  const body =
    payload?.data?.body ||
    payload?.notification?.body ||
    "Tienes una nueva notificacion de ruta.";
  const kind =
    payload?.data?.kind ||
    payload?.notification?.tag ||
    "student-route-update";
  const link =
    payload?.fcmOptions?.link ||
    payload?.data?.link ||
    payload?.notification?.click_action ||
    "/recorrido";
  const tag =
    payload?.notification?.tag ||
    (kind === "monitor-offline" ? "schoolways-monitor-offline" : "schoolways-route-alert");
  const actions = Array.isArray(payload?.notification?.actions)
    ? payload.notification.actions
    : [
        {
          action: "open-route",
          title: kind === "monitor-offline" ? "Abrir mapa" : "Ver recorrido",
        },
      ];

  self.registration.showNotification(title, {
    body,
    icon: payload?.notification?.icon || "/logo.png",
    badge: payload?.notification?.badge || "/favicon.ico",
    image: payload?.notification?.image || "/icons/map.png",
    vibrate: kind === "monitor-offline" ? [220, 120, 220, 120, 260] : [180, 90, 180],
    renotify: payload?.notification?.renotify !== false,
    requireInteraction: Boolean(payload?.notification?.requireInteraction),
    tag,
    actions,
    data: {
      link,
      kind,
    },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification?.data?.link || "/recorrido";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.includes(target) && "focus" in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(target);
        }
        return null;
      })
  );
});
`;

  return new NextResponse(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}
