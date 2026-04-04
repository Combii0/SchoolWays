import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  getAdminAuth,
  getAdminDb,
  getAdminMessaging,
} from "../../../lib/firebaseAdmin";
import { isStudentProfile } from "../../../lib/profileRoles";

export const runtime = "nodejs";

const SERVICE_TIME_ZONE = "America/Bogota";

const toText = (value) => {
  if (value === null || value === undefined) return "";
  return value.toString().trim();
};

const normalizeRouteId = (value) => {
  const routeText = toText(value);
  if (!routeText) return "";
  return routeText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
};

const readBearerToken = (request) => {
  const raw = request.headers.get("authorization") || "";
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
};

const extractPushTokens = (profile) => {
  const tokens = [];
  const direct = profile?.pushNotifications?.web?.token;
  if (typeof direct === "string" && direct.trim()) {
    tokens.push(direct.trim());
  }

  const list = profile?.pushNotifications?.web?.tokens;
  if (Array.isArray(list)) {
    list.forEach((item) => {
      if (typeof item === "string" && item.trim()) {
        tokens.push(item.trim());
      }
    });
  }

  if (typeof profile?.fcmToken === "string" && profile.fcmToken.trim()) {
    tokens.push(profile.fcmToken.trim());
  }

  return [...new Set(tokens)];
};

const isInvalidTokenCode = (code) =>
  code === "messaging/registration-token-not-registered" ||
  code === "messaging/invalid-registration-token";

const cleanupInvalidToken = async (db, uid, token) => {
  if (!uid || !token) return;
  const userRef = db.collection("users").doc(uid);
  const snapshot = await userRef.get();
  if (!snapshot.exists) return;
  const data = snapshot.data() || {};
  const storedToken = data?.pushNotifications?.web?.token;

  if (storedToken === token) {
    await userRef.set(
      {
        pushNotifications: {
          web: {
            token: FieldValue.delete(),
            enabled: false,
            updatedAt: FieldValue.serverTimestamp(),
          },
        },
      },
      { merge: true }
    );
    return;
  }

  const tokenList = Array.isArray(data?.pushNotifications?.web?.tokens)
    ? data.pushNotifications.web.tokens
    : [];
  if (!tokenList.length) return;
  const cleaned = tokenList.filter((item) => item !== token);
  await userRef.set(
    {
      pushNotifications: {
        web: {
          tokens: cleaned,
          updatedAt: FieldValue.serverTimestamp(),
        },
      },
    },
    { merge: true }
  );
};

const enqueueInAppNotification = async ({ db, uid, routeId, message }) => {
  if (!uid || !message) return { delivered: false };
  const notificationId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await db
      .collection("users")
      .doc(uid)
      .set(
        {
          lastRouteNotification: {
            id: notificationId,
            title: "SchoolWays",
            body: message,
            kind: "monitor-offline",
            routeId: routeId || null,
            createdAt: FieldValue.serverTimestamp(),
          },
        },
        { merge: true }
      );
    return { delivered: true };
  } catch (error) {
    return { delivered: false };
  }
};

const sendPushMessage = async ({ messaging, db, uid, profile, routeId, message }) => {
  const tokens = extractPushTokens(profile);
  if (!tokens.length) {
    return { delivered: false, tokenCount: 0, reason: "no-token" };
  }

  const payload = {
    tokens,
    data: {
      title: "SchoolWays",
      body: message,
      routeId,
      kind: "monitor-offline",
      at: Date.now().toString(),
    },
    webpush: {
      headers: {
        Urgency: "high",
        TTL: "120",
      },
      notification: {
        title: "SchoolWays",
        body: message,
        icon: "/logo.png",
        badge: "/favicon.ico",
        tag: "schoolways-monitor-offline",
      },
      fcmOptions: {
        link: "/",
      },
    },
  };

  let response;
  try {
    response = await messaging.sendEachForMulticast(payload);
  } catch (error) {
    return {
      delivered: false,
      tokenCount: tokens.length,
      reason: error?.code || "send-error",
    };
  }

  if (response.failureCount > 0) {
    await Promise.all(
      response.responses.map(async (item, index) => {
        if (item.success) return;
        const token = tokens[index];
        const code = item.error?.code || "";
        if (isInvalidTokenCode(code)) {
          await cleanupInvalidToken(db, uid, token);
        }
      })
    );
  }

  return {
    delivered: response.successCount > 0,
    tokenCount: tokens.length,
    reason:
      response.successCount > 0
        ? "sent"
        : response.responses.find((item) => !item.success)?.error?.code || "all-failed",
  };
};

const formatOfflineTime = (value) => {
  try {
    return new Intl.DateTimeFormat("es-CO", {
      timeZone: SERVICE_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(value));
  } catch (error) {
    return "--:--:--";
  }
};

const buildAlertStateId = ({ uid, routeId, lastLocationUpdatedAt }) => {
  const safeUid = toText(uid).replace(/[^a-zA-Z0-9_-]/g, "-");
  const safeRoute = normalizeRouteId(routeId || "route") || "route";
  const safeLastSeen = String(Math.max(0, Math.round(Number(lastLocationUpdatedAt) / 1000)));
  return `${safeRoute}__${safeUid}__monitor-offline__${safeLastSeen}`;
};

export async function POST(request) {
  const token = readBearerToken(request);
  if (!token) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let adminAuth;
  let db;
  let messaging;
  try {
    adminAuth = getAdminAuth();
    db = getAdminDb();
    messaging = getAdminMessaging();
  } catch (error) {
    return NextResponse.json({ error: "Firebase Admin no configurado" }, { status: 500 });
  }

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(token);
  } catch (error) {
    return NextResponse.json({ error: "Token invalido" }, { status: 401 });
  }

  const userRef = db.collection("users").doc(decoded.uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    return NextResponse.json({ error: "Perfil no encontrado" }, { status: 404 });
  }

  const profile = userSnap.data() || {};
  if (!isStudentProfile(profile)) {
    return NextResponse.json({ error: "Solo estudiantes autorizados" }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const eventType = toText(body?.eventType).toLowerCase();
  if (eventType !== "monitor_offline") {
    return NextResponse.json({ error: "eventType invalido" }, { status: 400 });
  }

  const routeId = normalizeRouteId(body?.routeId || profile?.route);
  if (!routeId) {
    return NextResponse.json({ error: "routeId requerido" }, { status: 400 });
  }

  const profileRouteId = normalizeRouteId(profile?.route);
  if (profileRouteId && profileRouteId !== routeId) {
    return NextResponse.json({ error: "Ruta no autorizada" }, { status: 403 });
  }

  const offlineAtMs = Number(body?.lastLocationUpdatedAt);
  if (!Number.isFinite(offlineAtMs) || offlineAtMs <= 0) {
    return NextResponse.json({ error: "lastLocationUpdatedAt invalido" }, { status: 400 });
  }

  const stateId = buildAlertStateId({
    uid: decoded.uid,
    routeId,
    lastLocationUpdatedAt: offlineAtMs,
  });
  const stateRef = db.collection("routeStatusAlerts").doc(stateId);
  const stateSnap = await stateRef.get();
  if (stateSnap.exists) {
    return NextResponse.json({ ok: true, alreadySent: true }, { status: 200 });
  }

  const lastSeenLabel = formatOfflineTime(offlineAtMs);
  const message = `La monitora se desconectó temporalmente del servidor. Última señal: ${lastSeenLabel}.`;

  const inAppResult = await enqueueInAppNotification({
    db,
    uid: decoded.uid,
    routeId,
    message,
  });
  const pushResult = await sendPushMessage({
    messaging,
    db,
    uid: decoded.uid,
    profile,
    routeId,
    message,
  });

  await stateRef.set(
    {
      uid: decoded.uid,
      routeId,
      institutionCode: toText(profile?.institutionCode) || null,
      alertType: "monitor_offline",
      lastLocationUpdatedAt: offlineAtMs,
      deliveredInApp: Boolean(inAppResult.delivered),
      deliveredPush: Boolean(pushResult.delivered),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return NextResponse.json(
    {
      ok: true,
      deliveredInApp: Boolean(inAppResult.delivered),
      deliveredPush: Boolean(pushResult.delivered),
      reason: pushResult.reason || null,
    },
    { status: 200 }
  );
}
