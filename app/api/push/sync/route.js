import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  getAdminAuth,
  getAdminDb,
  getAdminMessaging,
} from "../../../lib/firebaseAdmin";

export const runtime = "nodejs";

const EVENT_TYPES = {
  ETA_UPDATE: "eta_update",
  STOP_STATUS_UPDATE: "stop_status_update",
};

const STOP_STATUS = {
  BOARDED: "boarded",
  MISSED_BUS: "missed_bus",
};

const SERVICE_TIME_ZONE = "America/Bogota";

const toText = (value) => {
  if (value === null || value === undefined) return "";
  return value.toString().trim();
};

const toLowerText = (value) => toText(value).toLowerCase();

const normalizeKeyPart = (value) =>
  toText(value)
    .toLowerCase()
    .replaceAll("/", "-")
    .replace(/\s+/g, " ");

const normalizeStopKey = (stop) => {
  if (!stop || typeof stop !== "object") return "";
  const id = normalizeKeyPart(stop.id ?? stop.key);
  if (id) return id;
  const address = normalizeKeyPart(stop.address);
  if (address) return address;
  return normalizeKeyPart(stop.title);
};

const normalizeRouteId = (value) => {
  const routeText = toText(value);
  if (!routeText) return "";
  return routeText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
};

const normalizeMatchText = (value) => {
  return toText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
};

const firstAddressSegment = (value) => toText(value).split(",")[0]?.trim() || "";

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

const isStudentProfile = (profile) => {
  if (!profile || isMonitorProfile(profile)) return false;
  const accountType = toLowerText(profile?.accountType);
  const role = toLowerText(profile?.role);
  if (accountType === "student" || accountType === "estudiante") return true;
  if (role === "student" || role === "estudiante") return true;
  return Boolean(profile?.studentCode || profile?.studentName || profile?.stopAddress);
};

const getStudentDisplayName = (profile) => {
  const fallbackName = [toText(profile?.firstName), toText(profile?.lastName)]
    .filter(Boolean)
    .join(" ")
    .trim();
  const candidates = [
    profile?.studentName,
    profile?.displayName,
    profile?.fullName,
    profile?.name,
    fallbackName,
  ];
  const selected = candidates.map(toText).find(Boolean);
  return selected || "Estudiante";
};

const getServiceDateKey = (date = new Date()) => {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: SERVICE_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(date);
  } catch (error) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
};

const parseInteger = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return Math.round(parsed);
    }
  }
  return null;
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

const readBearerToken = (request) => {
  const raw = request.headers.get("authorization") || "";
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
};

const buildStateId = ({ dateKey, routeId, uid }) => {
  const safeDate = toText(dateKey).replace(/[^a-zA-Z0-9_-]/g, "-");
  const safeRoute = normalizeRouteId(routeId || "route") || "route";
  const safeUid = toText(uid).replace(/[^a-zA-Z0-9_-]/g, "-");
  return `${safeDate}__${safeRoute}__${safeUid}`;
};

const isInvalidTokenCode = (code) => {
  return (
    code === "messaging/registration-token-not-registered" ||
    code === "messaging/invalid-registration-token"
  );
};

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

const sendPushMessage = async ({ messaging, db, student, message }) => {
  const tokens = extractPushTokens(student.profile);
  if (!tokens.length) {
    return { delivered: false, tokenCount: 0 };
  }

  const payload = {
    tokens,
    data: {
      title: "SchoolWays",
      body: message,
      routeId: student.routeId,
      kind: "student-route-update",
    },
    webpush: {
      fcmOptions: {
        link: "/recorrido",
      },
    },
  };

  let response;
  try {
    response = await messaging.sendEachForMulticast(payload);
  } catch (error) {
    return { delivered: false, tokenCount: tokens.length };
  }

  if (response.failureCount > 0) {
    await Promise.all(
      response.responses.map(async (item, index) => {
        if (item.success) return;
        const token = tokens[index];
        const code = item.error?.code || "";
        if (isInvalidTokenCode(code)) {
          await cleanupInvalidToken(db, student.uid, token);
        }
      })
    );
  }

  return {
    delivered: response.successCount > 0,
    tokenCount: tokens.length,
  };
};

const buildStops = (rawStops) => {
  if (!Array.isArray(rawStops)) return [];

  return rawStops
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const key = normalizeStopKey(item) || normalizeStopKey({ key: `paradero-${index + 1}` });
      if (!key) return null;

      const orderValue = parseInteger(item.order ?? item.sourceIndex);
      return {
        key,
        address: toText(item.address),
        title: toText(item.title) || `Paradero ${index + 1}`,
        order: orderValue !== null ? orderValue : index,
        minutes: parseInteger(item.minutes),
        status: toLowerText(item.status),
        excluded: Boolean(item.excluded),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order);
};

const findChangedStop = (changedStop, stops) => {
  if (!changedStop || typeof changedStop !== "object") return null;

  const key = normalizeStopKey(changedStop);
  const byKey = key ? stops.find((item) => item.key === key) : null;
  if (byKey) {
    return {
      ...byKey,
      status: toLowerText(changedStop.status) || byKey.status,
    };
  }

  const addressMatch = normalizeMatchText(changedStop.address);
  const titleMatch = normalizeMatchText(changedStop.title);
  return (
    stops.find((item) => {
      const stopAddress = normalizeMatchText(item.address);
      const stopTitle = normalizeMatchText(item.title);
      return (
        (addressMatch && stopAddress && addressMatch === stopAddress) ||
        (titleMatch && stopTitle && titleMatch === stopTitle)
      );
    }) || null
  );
};

const resolveStudentStop = (student, stops) => {
  if (!student || !stops.length) return null;

  const stopAddress = toText(student.profile?.stopAddress);
  const stopAddressNoCity = firstAddressSegment(stopAddress);
  const addressNorm = normalizeMatchText(stopAddress);
  const addressNoCityNorm = normalizeMatchText(stopAddressNoCity);

  const byAddress = stops.find((item) => {
    const stopAddressNorm = normalizeMatchText(item.address);
    const stopTitleNorm = normalizeMatchText(item.title);
    if (!stopAddressNorm && !stopTitleNorm) return false;

    return (
      (addressNorm && (addressNorm === stopAddressNorm || addressNorm === stopTitleNorm)) ||
      (addressNoCityNorm &&
        (addressNoCityNorm === stopAddressNorm || addressNoCityNorm === stopTitleNorm))
    );
  });

  if (byAddress) return byAddress;

  if (!addressNorm && !addressNoCityNorm) return null;

  return (
    stops.find((item) => {
      const stopAddressNorm = normalizeMatchText(item.address);
      const stopTitleNorm = normalizeMatchText(item.title);
      return (
        (addressNorm &&
          stopAddressNorm &&
          (stopAddressNorm.includes(addressNorm) || addressNorm.includes(stopAddressNorm))) ||
        (addressNoCityNorm &&
          ((stopAddressNorm &&
            (stopAddressNorm.includes(addressNoCityNorm) ||
              addressNoCityNorm.includes(stopAddressNorm))) ||
            (stopTitleNorm &&
              (stopTitleNorm.includes(addressNoCityNorm) ||
                addressNoCityNorm.includes(stopTitleNorm)))))
      );
    }) || null
  );
};

const buildRemainingStopsMessage = (name, remainingStops) => {
  const unit = remainingStops === 1 ? "parada" : "paradas";
  return `${name}, estamos a ${remainingStops} ${unit} de llegar por ti! :)`;
};

const buildEtaMessage = (name, minutes) => {
  return `${name}, faltan aproximadamente ${minutes} minutos para llegar por ti! ;)`;
};

const buildPickedUpMessage = (name) => {
  return `${name} ya esta en la ruta; En camino al colegio! :)`;
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
    return NextResponse.json(
      {
        error: "Firebase Admin no configurado",
        detail:
          "Define FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL y FIREBASE_ADMIN_PRIVATE_KEY.",
      },
      { status: 500 }
    );
  }

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(token);
  } catch (error) {
    return NextResponse.json({ error: "Token invalido" }, { status: 401 });
  }

  const monitorUid = decoded.uid;
  const monitorRef = db.collection("users").doc(monitorUid);
  const monitorSnap = await monitorRef.get();
  if (!monitorSnap.exists) {
    return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
  }

  const monitorProfile = monitorSnap.data() || {};
  if (!isMonitorProfile(monitorProfile)) {
    return NextResponse.json({ error: "Solo monitoras autorizadas" }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const eventType = toLowerText(body?.eventType);
  if (eventType !== EVENT_TYPES.ETA_UPDATE && eventType !== EVENT_TYPES.STOP_STATUS_UPDATE) {
    return NextResponse.json({ error: "eventType invalido" }, { status: 400 });
  }

  const monitorRouteId = normalizeRouteId(monitorProfile?.route);
  const routeId = normalizeRouteId(body?.routeId || body?.route || monitorRouteId);
  if (!routeId) {
    return NextResponse.json({ error: "No se pudo resolver la ruta" }, { status: 400 });
  }

  const institutionCode =
    toText(monitorProfile?.institutionCode) || toText(body?.institutionCode);
  if (!institutionCode) {
    return NextResponse.json(
      { error: "No se pudo resolver el colegio de la monitora" },
      { status: 400 }
    );
  }

  const stops = buildStops(body?.stops || []);
  if (!stops.length) {
    return NextResponse.json(
      {
        ok: true,
        sent: 0,
        skipped: 0,
        reason: "Sin paraderos para evaluar",
      },
      { status: 200 }
    );
  }

  const changedStop = findChangedStop(body?.changedStop, stops);
  const changedStopStatus = toLowerText(body?.changedStop?.status || changedStop?.status);

  const studentsSnap = await db
    .collection("users")
    .where("institutionCode", "==", institutionCode)
    .get();

  const studentCandidates = studentsSnap.docs
    .map((item) => {
      const profile = item.data() || {};
      return {
        uid: item.id,
        profile,
        routeId: normalizeRouteId(profile?.route),
      };
    })
    .filter((student) => {
      if (!isStudentProfile(student.profile)) return false;
      if (student.routeId && student.routeId !== routeId) return false;
      return true;
    });

  if (!studentCandidates.length) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0 }, { status: 200 });
  }

  const dateKey = getServiceDateKey();
  const stateRefs = studentCandidates.map((student) => {
    const stateId = buildStateId({ dateKey, routeId, uid: student.uid });
    return {
      uid: student.uid,
      ref: db.collection("routePushStates").doc(stateId),
    };
  });

  const stateSnapshots = await Promise.all(stateRefs.map((item) => item.ref.get()));
  const stateByUid = {};
  stateSnapshots.forEach((snapshot, index) => {
    const uid = stateRefs[index].uid;
    stateByUid[uid] = snapshot.exists ? snapshot.data() || {} : {};
  });

  const writes = [];
  let sent = 0;
  let skipped = 0;

  for (const student of studentCandidates) {
    const studentStop = resolveStudentStop(student, stops);
    if (!studentStop) {
      skipped += 1;
      continue;
    }

    const state = stateByUid[student.uid] || {};
    const name = getStudentDisplayName(student.profile);
    const statusValue = toLowerText(studentStop.status);
    const isMissed = studentStop.excluded || statusValue === STOP_STATUS.MISSED_BUS;
    const isBoarded = statusValue === STOP_STATUS.BOARDED;

    let message = "";
    let statePatch = null;

    if (eventType === EVENT_TYPES.ETA_UPDATE && !isMissed && !isBoarded) {
      const minutes = parseInteger(studentStop.minutes);
      if (minutes !== null && minutes <= 5 && !state.eta5Sent) {
        message = buildEtaMessage(name, 5);
        statePatch = {
          eta15Sent: true,
          eta5Sent: true,
        };
      } else if (minutes !== null && minutes <= 15 && !state.eta15Sent) {
        message = buildEtaMessage(name, 15);
        statePatch = {
          eta15Sent: true,
        };
      }
    }

    if (
      !message &&
      eventType === EVENT_TYPES.STOP_STATUS_UPDATE &&
      changedStop &&
      changedStopStatus === STOP_STATUS.BOARDED
    ) {
      const sameStop = studentStop.key === changedStop.key;
      if (sameStop) {
        if (!state.pickedUpSent) {
          message = buildPickedUpMessage(name);
          statePatch = {
            pickedUpSent: true,
          };
        }
      } else if (!isMissed && !isBoarded && studentStop.order > changedStop.order) {
        const remainingStops = studentStop.order - changedStop.order;
        if (
          remainingStops >= 1 &&
          parseInteger(state.lastStopsRemainingNotified) !== remainingStops
        ) {
          message = buildRemainingStopsMessage(name, remainingStops);
          statePatch = {
            lastStopsRemainingNotified: remainingStops,
          };
        }
      }
    }

    if (!message || !statePatch) {
      skipped += 1;
      continue;
    }

    const pushResult = await sendPushMessage({ messaging, db, student, message });
    if (!pushResult.delivered) {
      skipped += 1;
      continue;
    }

    sent += 1;
    const stateId = buildStateId({ dateKey, routeId, uid: student.uid });
    writes.push(
      db
        .collection("routePushStates")
        .doc(stateId)
        .set(
          {
            uid: student.uid,
            routeId,
            dateKey,
            institutionCode,
            monitorUid,
            updatedAt: FieldValue.serverTimestamp(),
            ...statePatch,
          },
          { merge: true }
        )
    );
  }

  if (writes.length) {
    await Promise.all(writes);
  }

  return NextResponse.json({ ok: true, sent, skipped }, { status: 200 });
}
