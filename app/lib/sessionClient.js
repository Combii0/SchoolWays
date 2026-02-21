"use client";

import {
  deleteField,
  doc,
  getDoc,
  runTransaction,
  setDoc,
} from "firebase/firestore";

const DEVICE_ID_KEY = "schoolways:deviceId";
const SESSION_TTL_MS = 2 * 60 * 1000;
const HEARTBEAT_MS = 30 * 1000;

const getNow = () => Date.now();

const parseMillis = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === "function") {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value === "string") {
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
};

const createDeviceId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `device-${Math.random().toString(36).slice(2, 10)}-${getNow()}`;
};

export const getDeviceId = () => {
  if (typeof window === "undefined") return "server";
  const saved = window.localStorage.getItem(DEVICE_ID_KEY);
  if (saved) return saved;
  const created = createDeviceId();
  window.localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
};

const isSessionFresh = (session, nowMs) => {
  const lastSeen = parseMillis(session?.lastSeenAt);
  if (!Number.isFinite(lastSeen)) return false;
  return nowMs - lastSeen <= SESSION_TTL_MS;
};

const getUserRef = (db, uid) => doc(db, "users", uid);

export const claimSingleDeviceSession = async (db, uid) => {
  const deviceId = getDeviceId();
  const nowMs = getNow();
  const userAgent =
    typeof navigator !== "undefined" ? navigator.userAgent || null : null;

  let blocked = false;

  await runTransaction(db, async (transaction) => {
    const userRef = getUserRef(db, uid);
    const snapshot = await transaction.get(userRef);
    const data = snapshot.exists() ? snapshot.data() : {};
    const currentSession = data?.activeSession || null;

    const sameDevice = currentSession?.deviceId === deviceId;
    const freshOtherDevice =
      currentSession &&
      !sameDevice &&
      currentSession?.deviceId &&
      isSessionFresh(currentSession, nowMs);

    if (freshOtherDevice) {
      blocked = true;
      return;
    }

    transaction.set(
      userRef,
      {
        activeSession: {
          deviceId,
          userAgent,
          claimedAt: sameDevice
            ? parseMillis(currentSession?.claimedAt) || nowMs
            : nowMs,
          lastSeenAt: nowMs,
        },
      },
      { merge: true }
    );
  });

  return { ok: !blocked, deviceId };
};

export const keepSessionAlive = async (db, uid) => {
  try {
    const deviceId = getDeviceId();
    const nowMs = getNow();
    const userRef = getUserRef(db, uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) return false;
    const activeSession = snap.data()?.activeSession || null;
    if (activeSession?.deviceId !== deviceId) return false;
    const userAgent =
      typeof navigator !== "undefined" ? navigator.userAgent || null : null;
    await setDoc(
      userRef,
      {
        activeSession: {
          deviceId,
          userAgent: activeSession?.userAgent || userAgent,
          claimedAt: parseMillis(activeSession?.claimedAt) || nowMs,
          lastSeenAt: nowMs,
        },
      },
      { merge: true }
    );
    return true;
  } catch (error) {
    // Keep session heartbeat best-effort to avoid console noise in UI.
    return false;
  }
};

export const releaseSingleDeviceSession = async (db, uid) => {
  const deviceId = getDeviceId();
  await runTransaction(db, async (transaction) => {
    const userRef = getUserRef(db, uid);
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists()) return;
    const activeSession = snapshot.data()?.activeSession || null;
    if (activeSession?.deviceId !== deviceId) return;
    transaction.set(userRef, { activeSession: deleteField() }, { merge: true });
  });
};

export const isSessionOwnedByCurrentDevice = (session) =>
  Boolean(session?.deviceId && session.deviceId === getDeviceId());

export const isSessionStale = (session) => !isSessionFresh(session, getNow());

export const SESSION_HEARTBEAT_MS = HEARTBEAT_MS;
