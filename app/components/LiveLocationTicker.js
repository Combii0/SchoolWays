"use client";

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebaseClient";
import { isMonitorProfile } from "../lib/profileRoles";

const SEND_INTERVAL_MS = 5000;
const LOCATION_LOG_TAG = `global-${Math.round(SEND_INTERVAL_MS / 1000)}s`;
const ROUTE_LIVE_COLLECTIONS = ["routes", "rutas"];
export const LOCATION_TICK_EVENT = "schoolways:location-tick";
export const LOCATION_TOGGLE_EVENT = "schoolways:location-toggle";
export const LOCATION_ENABLED_STORAGE_KEY = "schoolways:location-enabled";
const GEOLOCATION_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 20000,
};
const GEOLOCATION_FALLBACK_OPTIONS = {
  enableHighAccuracy: false,
  maximumAge: 12000,
  timeout: 10000,
};
const HIGH_ACCURACY_MAX_METERS = 70;
const NO_FIX_RELAX_AFTER_MS = 15000;
const NO_FIX_RELAX_ACCURACY_METERS = 110;
const TARGET_ACCURACY_METERS = 38;
const BEST_EFFORT_ACCURACY_METERS = 85;
const HARD_REJECT_ACCURACY_METERS = 180;
const MAX_NOISY_JUMP_METERS = 140;
const STABLE_FIX_REUSE_MS = 10000;
const RELAX_ACCURACY_AFTER_MS = 7000;
const MAX_REPORTED_FIX_AGE_MS = 10000;
const COARSE_FALLBACK_AFTER_MS = 30000;
const FIX_CLUSTER_WINDOW_MS = 9000;
const MAX_RECENT_FIXES = 6;
const MIN_CLUSTER_FIXES = 2;
const MAX_CLUSTER_RADIUS_METERS = 48;

const toText = (value) => {
  if (value === null || value === undefined) return "";
  return value.toString().trim();
};

const normalizeRouteId = (value) =>
  toText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const toRadians = (value) => (value * Math.PI) / 180;

const distanceMetersBetween = (a, b) => {
  if (!a || !b) return null;
  const lat1 = Number(a.lat);
  const lng1 = Number(a.lng);
  const lat2 = Number(b.lat);
  const lng2 = Number(b.lng);
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lng1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lng2)
  ) {
    return null;
  }

  const earthRadius = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const aa =
    sinLat * sinLat +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * sinLng * sinLng;
  const cc = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return earthRadius * cc;
};

const readLocationEnabled = () => {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(LOCATION_ENABLED_STORAGE_KEY);
  if (raw === null) return true;
  return raw === "1";
};

export default function LiveLocationTicker() {
  const [session, setSession] = useState({ uid: "", profile: null });
  const [locationEnabled, setLocationEnabled] = useState(true);
  const inFlightRef = useRef(false);

  useEffect(() => {
    let unsubscribeProfile = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (!user) {
        setSession({ uid: "", profile: null });
        return;
      }

      unsubscribeProfile = onSnapshot(
        doc(db, "users", user.uid),
        (snapshot) => {
          setSession({
            uid: user.uid,
            profile: snapshot.exists() ? snapshot.data() : null,
          });
        },
        () => {
          setSession({ uid: user.uid, profile: null });
        }
      );
    });

    return () => {
      if (unsubscribeProfile) {
        unsubscribeProfile();
      }
      unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setLocationEnabled(readLocationEnabled());

    const handleStorage = (event) => {
      if (event?.key !== LOCATION_ENABLED_STORAGE_KEY) return;
      setLocationEnabled(readLocationEnabled());
    };
    const handleToggle = () => {
      setLocationEnabled(readLocationEnabled());
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(LOCATION_TOGGLE_EVENT, handleToggle);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(LOCATION_TOGGLE_EVENT, handleToggle);
    };
  }, []);

  useEffect(() => {
    if (!locationEnabled) return;
    if (!session.uid || !isMonitorProfile(session.profile)) return;
    if (typeof window === "undefined" || !("geolocation" in navigator)) return;

    let cancelled = false;
    let watchId = null;
    let queuedWrite = null;
    const startedAtMs = Date.now();
    let latestFix = null;
    let stableFix = null;
    let lastSentAtMs = 0;
    let lastAcceptedFixAtMs = 0;
    let lastWarnAtMs = 0;
    let recentFixes = [];
    const route = toText(session.profile?.route);
    const routeId = normalizeRouteId(route);
    if (!routeId) return;

    const toFix = (position) => {
      const lat = Number(position?.coords?.latitude);
      const lng = Number(position?.coords?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      const nowMs = Date.now();
      const accuracy = Number(position?.coords?.accuracy);
      if (!Number.isFinite(accuracy)) {
        return null;
      }
      const allowedAccuracy =
        lastAcceptedFixAtMs > 0 && nowMs - lastAcceptedFixAtMs > NO_FIX_RELAX_AFTER_MS
          ? NO_FIX_RELAX_ACCURACY_METERS
          : HIGH_ACCURACY_MAX_METERS;
      if (accuracy > allowedAccuracy) {
        return null;
      }
      const reportedAtMsRaw = Number(position?.timestamp);
      const reportedAtMs = Number.isFinite(reportedAtMsRaw) ? reportedAtMsRaw : nowMs;
      if (
        latestFix &&
        Number.isFinite(reportedAtMs) &&
        nowMs - reportedAtMs > MAX_REPORTED_FIX_AGE_MS
      ) {
        return null;
      }

      return {
        lat,
        lng,
        accuracy,
        reportedAtMs,
        receivedAtMs: nowMs,
      };
    };

    const emitTickEvent = (fix) => {
      const sentAt = new Date().toISOString();
      const reportedAt = new Date(fix.reportedAtMs).toISOString();
      window.dispatchEvent(
        new CustomEvent(LOCATION_TICK_EVENT, {
          detail: {
            lat: fix.lat,
            lng: fix.lng,
            accuracy: fix.accuracy,
            sentAt,
            reportedAt,
          },
        })
      );
    };

    const fixAccuracy = (fix) =>
      Number.isFinite(fix?.accuracy) ? Number(fix.accuracy) : Number.POSITIVE_INFINITY;

    const fixAgeMs = (fix) =>
      Number.isFinite(fix?.receivedAtMs) ? Date.now() - Number(fix.receivedAtMs) : Number.POSITIVE_INFINITY;

    const pruneRecentFixes = (nowMs = Date.now()) => {
      recentFixes = recentFixes
        .filter((sample) => {
          return sample && nowMs - Number(sample.receivedAtMs || 0) <= FIX_CLUSTER_WINDOW_MS;
        })
        .sort((left, right) => (right.reportedAtMs || 0) - (left.reportedAtMs || 0))
        .slice(0, MAX_RECENT_FIXES);
    };

    const rememberFix = (fix) => {
      if (!fix) return;
      recentFixes = [
        fix,
        ...recentFixes.filter((sample) => {
          const sameMoment = Math.abs((sample?.reportedAtMs || 0) - fix.reportedAtMs) <= 250;
          const samePlace = distanceMetersBetween(sample, fix);
          return !sameMoment || (typeof samePlace === "number" && samePlace > 3);
        }),
      ];
      pruneRecentFixes(fix.receivedAtMs);
    };

    const buildSmoothedFix = (fallbackFix = null) => {
      pruneRecentFixes();
      const samples = recentFixes.filter((sample) => fixAgeMs(sample) <= FIX_CLUSTER_WINDOW_MS);
      if (!samples.length) return fallbackFix;

      const anchors = [
        fallbackFix,
        ...samples
          .slice()
          .sort((left, right) => fixAccuracy(left) - fixAccuracy(right) || right.reportedAtMs - left.reportedAtMs)
          .slice(0, 3),
      ].filter(Boolean);

      let bestCluster = null;
      anchors.forEach((anchor) => {
        const anchorAccuracy = fixAccuracy(anchor);
        const clusterRadius = Math.min(
          MAX_CLUSTER_RADIUS_METERS,
          Math.max(18, Math.round(anchorAccuracy * 0.75))
        );
        const cluster = samples.filter((sample) => {
          const distance = distanceMetersBetween(anchor, sample);
          return typeof distance !== "number" || distance <= clusterRadius;
        });
        if (!cluster.length) return;

        const averageAccuracy =
          cluster.reduce((sum, sample) => sum + fixAccuracy(sample), 0) / cluster.length;
        const totalWeight = cluster.reduce((sum, sample) => {
          const recencyWeight =
            1 + Math.max(0, FIX_CLUSTER_WINDOW_MS - fixAgeMs(sample)) / FIX_CLUSTER_WINDOW_MS;
          const accuracyWeight = 1 / Math.max(12, fixAccuracy(sample)) ** 2;
          return sum + recencyWeight * accuracyWeight;
        }, 0);
        const score = cluster.length * 1000 + totalWeight * 100000 - averageAccuracy;
        if (!bestCluster || score > bestCluster.score) {
          bestCluster = { anchor, cluster, score };
        }
      });

      if (!bestCluster) {
        return fallbackFix || samples[0];
      }
      if (
        bestCluster.cluster.length < MIN_CLUSTER_FIXES &&
        fixAccuracy(bestCluster.anchor) > TARGET_ACCURACY_METERS
      ) {
        return fallbackFix || bestCluster.anchor;
      }

      const totals = bestCluster.cluster.reduce(
        (accumulator, sample) => {
          const recencyWeight =
            1 + Math.max(0, FIX_CLUSTER_WINDOW_MS - fixAgeMs(sample)) / FIX_CLUSTER_WINDOW_MS;
          const accuracyWeight = 1 / Math.max(12, fixAccuracy(sample)) ** 2;
          const weight = recencyWeight * accuracyWeight;
          return {
            lat: accumulator.lat + sample.lat * weight,
            lng: accumulator.lng + sample.lng * weight,
            weight: accumulator.weight + weight,
          };
        },
        { lat: 0, lng: 0, weight: 0 }
      );
      if (!Number.isFinite(totals.weight) || totals.weight <= 0) {
        return fallbackFix || bestCluster.anchor;
      }

      return {
        lat: totals.lat / totals.weight,
        lng: totals.lng / totals.weight,
        accuracy: Math.max(
          8,
          Math.round(Math.min(...bestCluster.cluster.map((sample) => fixAccuracy(sample))))
        ),
        reportedAtMs: Math.max(...bestCluster.cluster.map((sample) => sample.reportedAtMs || 0)),
        receivedAtMs: Date.now(),
      };
    };

    const pickRawFixForNow = () => {
      if (!latestFix) return null;
      const latestAccuracy = fixAccuracy(latestFix);
      if (latestAccuracy <= TARGET_ACCURACY_METERS) {
        return latestFix;
      }

      if (stableFix && fixAgeMs(stableFix) <= STABLE_FIX_REUSE_MS) {
        const stableAccuracy = fixAccuracy(stableFix);
        if (latestAccuracy >= stableAccuracy + 12) {
          return stableFix;
        }
      }

      if (
        latestAccuracy <= BEST_EFFORT_ACCURACY_METERS &&
        Date.now() - startedAtMs >= RELAX_ACCURACY_AFTER_MS
      ) {
        return latestFix;
      }

      if (stableFix && fixAgeMs(stableFix) <= STABLE_FIX_REUSE_MS) {
        return stableFix;
      }

      return null;
    };

    const pickBestFixForNow = () => {
      const preferred = pickRawFixForNow();
      return buildSmoothedFix(preferred) || preferred;
    };

    const captureFix = (position) => {
      const fix = toFix(position);
      if (!fix) return null;
      const incomingAccuracy = fixAccuracy(fix);

      if (latestFix) {
        const latestAccuracy = fixAccuracy(latestFix);
        const jumpMeters = distanceMetersBetween(latestFix, fix);
        const latestIsRecent = fixAgeMs(latestFix) <= STABLE_FIX_REUSE_MS;
        const noisyBigJump =
          incomingAccuracy > TARGET_ACCURACY_METERS &&
          typeof jumpMeters === "number" &&
          jumpMeters > MAX_NOISY_JUMP_METERS;
        const shouldRejectNoisy =
          latestIsRecent &&
          (incomingAccuracy > HARD_REJECT_ACCURACY_METERS || noisyBigJump);
        if (shouldRejectNoisy) {
          const fallback = pickBestFixForNow() || latestFix;
          if (fallback) {
            emitTickEvent(fallback);
          }
          return fallback;
        }

        const isNewer = fix.reportedAtMs >= latestFix.reportedAtMs;
        const significantlyBetterAccuracy = incomingAccuracy + 10 < latestAccuracy;
        const comparableAccuracy = incomingAccuracy <= latestAccuracy + 12;
        if (significantlyBetterAccuracy || (isNewer && comparableAccuracy)) {
          latestFix = fix;
        }
      } else {
        latestFix = fix;
      }

      if (
        incomingAccuracy <= TARGET_ACCURACY_METERS &&
        (!stableFix ||
          incomingAccuracy <= fixAccuracy(stableFix) + 5 ||
          fix.reportedAtMs >= stableFix.reportedAtMs)
      ) {
        stableFix = fix;
      }

      rememberFix(fix);
      const selected = pickBestFixForNow() || latestFix;
      if (selected) {
        lastAcceptedFixAtMs = Date.now();
        emitTickEvent(selected);
      }
      return selected;
    };

    const flushQueuedWrite = async () => {
      if (cancelled || inFlightRef.current) return;
      const nextWrite = queuedWrite;
      if (!nextWrite?.fix) return;
      queuedWrite = null;
      const { fix, reason = "interval" } = nextWrite;
      inFlightRef.current = true;

      const sentAtMs = Date.now();
      const sentAt = new Date(sentAtMs).toISOString();
      const reportedAt = new Date(fix.reportedAtMs).toISOString();
      const accuracyText = Number.isFinite(fix.accuracy)
        ? ` +/-${Math.round(fix.accuracy)}m`
        : "";

      console.log(
        `[SchoolWays GPS][${LOCATION_LOG_TAG}][${reason}] sentAt=${sentAt} reportedAt=${reportedAt} lat=${fix.lat.toFixed(6)} lng=${fix.lng.toFixed(6)}${accuracyText}`
      );

      try {
        const writes = ROUTE_LIVE_COLLECTIONS.map((rootCollection) => {
          const liveRef = doc(db, rootCollection, routeId, "live", "current");
          return setDoc(
            liveRef,
            {
              uid: session.uid,
              route,
              lat: fix.lat,
              lng: fix.lng,
              accuracy: fix.accuracy,
              updatedAtClientMs: sentAtMs,
              updatedAtMs: fix.reportedAtMs,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        });
        await Promise.allSettled(writes);
        lastSentAtMs = sentAtMs;
      } catch (error) {
        console.warn(
          `[SchoolWays GPS][${LOCATION_LOG_TAG}][${reason}] sentAt=${sentAt} reportedAt=${reportedAt} firestore-write-failed`
        );
      } finally {
        inFlightRef.current = false;
        if (queuedWrite && !cancelled) {
          void flushQueuedWrite();
        }
      }
    };

    const scheduleWrite = (fix, reason = "interval") => {
      if (!fix || cancelled) return;
      queuedWrite = { fix, reason };
      if (inFlightRef.current) return;
      void flushQueuedWrite();
    };

    const requestSingleFix = (reason = "single") => {
      const handlePosition = (position) => {
        if (cancelled) return;
        const fix = captureFix(position);
        if (!fix) return;
        const preferred = pickBestFixForNow() || fix;
        const shouldWriteNow =
          lastSentAtMs === 0 || Date.now() - lastSentAtMs >= SEND_INTERVAL_MS - 250;
        if (preferred && shouldWriteNow) {
          scheduleWrite(preferred, reason);
        }
      };

      const logWarn = (code, message, source) => {
        const now = Date.now();
        if (now - lastWarnAtMs < 30000) return;
        lastWarnAtMs = now;
        const sentAt = new Date(now).toISOString();
        console.warn(
          `[SchoolWays GPS][${LOCATION_LOG_TAG}][${source}] sentAt=${sentAt} geolocation-error code=${
            Number.isFinite(code) ? code : "unknown"
          } message=${message || "unknown"}`
        );
      };

      const shouldAttemptCoarseFallback = () =>
        lastAcceptedFixAtMs === 0 || Date.now() - lastAcceptedFixAtMs >= COARSE_FALLBACK_AFTER_MS;

      navigator.geolocation.getCurrentPosition(
        handlePosition,
        (error) => {
          const code = Number(error?.code);
          const message = toText(error?.message) || "unknown";
          if (code === 2 || code === 3) {
            // Avoid downgrading to coarse fixes unless we have gone too long without a usable fix.
            if (shouldAttemptCoarseFallback()) {
              navigator.geolocation.getCurrentPosition(
                handlePosition,
                () => null,
                GEOLOCATION_FALLBACK_OPTIONS
              );
            }
            return;
          }
          if (code === 2) return;
          logWarn(code, message, reason);
        },
        GEOLOCATION_OPTIONS
      );
    };

    const handleWatchPosition = (position, reason = "watch") => {
      if (cancelled) return;
      const fix = captureFix(position);
      if (!fix) return;
      const preferred = pickBestFixForNow() || fix;
      if (preferred && lastSentAtMs === 0) {
        scheduleWrite(preferred, `${reason}-first-fix`);
      }
    };

    const handleWatchError = (error, source = "watch") => {
      const code = Number(error?.code);
      const message = toText(error?.message) || "unknown";
      if (code === 2 || code === 3) return;
      const now = Date.now();
      if (now - lastWarnAtMs < 30000) return;
      lastWarnAtMs = now;
      const sentAt = new Date(now).toISOString();
      console.warn(
        `[SchoolWays GPS][${LOCATION_LOG_TAG}][${source}] sentAt=${sentAt} geolocation-error code=${
          Number.isFinite(code) ? code : "unknown"
        } message=${message}`
      );
    };

    const recoverFreshFix = (reason = "recovery") => {
      if (cancelled) return;
      const preferred = pickBestFixForNow();
      const shouldWrite =
        preferred && (lastSentAtMs === 0 || Date.now() - lastSentAtMs >= SEND_INTERVAL_MS - 250);
      if (preferred && shouldWrite) {
        scheduleWrite(preferred, `${reason}-cached`);
      }
      requestSingleFix(reason);
    };

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        handleWatchPosition(position, "watch");
      },
      (error) => {
        handleWatchError(error, "watch");
        recoverFreshFix("watch-recovery");
      },
      GEOLOCATION_OPTIONS
    );

    const tick = () => {
      const preferred = pickBestFixForNow();
      if (preferred) {
        const shouldWrite =
          lastSentAtMs === 0 || Date.now() - lastSentAtMs >= SEND_INTERVAL_MS - 250;
        if (shouldWrite) {
          scheduleWrite(preferred, "interval");
        }
      }
      requestSingleFix(preferred ? "interval-refresh" : "interval-fallback");
    };

    requestSingleFix("startup");
    const intervalId = window.setInterval(tick, SEND_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (!document.hidden) {
        recoverFreshFix("foreground");
      }
    };
    const handleOnline = () => {
      recoverFreshFix("online");
    };
    const handleFocus = () => {
      recoverFreshFix("focus");
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      queuedWrite = null;
      inFlightRef.current = false;
      window.clearInterval(intervalId);
      if (watchId !== null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(watchId);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("focus", handleFocus);
    };
  }, [locationEnabled, session.uid, session.profile]);

  return null;
}
