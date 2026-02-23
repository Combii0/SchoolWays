"use client";

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebaseClient";

const SEND_INTERVAL_MS = 5000;
export const LOCATION_TICK_EVENT = "schoolways:location-tick";
const GEOLOCATION_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 2000,
  timeout: 10000,
};

const toText = (value) => {
  if (value === null || value === undefined) return "";
  return value.toString().trim();
};

const toLowerText = (value) => toText(value).toLowerCase();

const normalizeRouteId = (value) =>
  toText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const isMonitorProfile = (profile) => {
  if (!profile || typeof profile !== "object") return false;

  const role = toLowerText(profile.role);
  const accountType = toLowerText(profile.accountType);
  if (
    role === "monitor" ||
    role === "monitora" ||
    accountType === "monitor" ||
    accountType === "monitora"
  ) {
    return true;
  }

  if (
    role === "student" ||
    role === "estudiante" ||
    accountType === "student" ||
    accountType === "estudiante"
  ) {
    return false;
  }

  return Boolean(profile.route) && Boolean(profile.institutionCode || profile.institutionName);
};

export default function LiveLocationTicker() {
  const [session, setSession] = useState({ uid: "", profile: null });
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
    if (!session.uid || !isMonitorProfile(session.profile)) return;
    if (typeof window === "undefined" || !("geolocation" in navigator)) return;

    let cancelled = false;
    const route = toText(session.profile?.route);
    const routeId = normalizeRouteId(route);
    if (!routeId) return;

    const tick = () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const sentAt = new Date().toISOString();
          const reportedAtMs = Number(position?.timestamp);
          const reportedAt = Number.isFinite(reportedAtMs)
            ? new Date(reportedAtMs).toISOString()
            : "unknown";
          const lat = Number(position?.coords?.latitude);
          const lng = Number(position?.coords?.longitude);
          const accuracy = Number(position?.coords?.accuracy);
          const accuracyText = Number.isFinite(accuracy) ? ` +/-${Math.round(accuracy)}m` : "";

          if (cancelled) {
            inFlightRef.current = false;
            return;
          }

          if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            console.warn(
              `[SchoolWays GPS][global-5s] sentAt=${sentAt} reportedAt=${reportedAt} invalid-coordinates`
            );
            inFlightRef.current = false;
            return;
          }

          console.log(
            `[SchoolWays GPS][global-5s] sentAt=${sentAt} reportedAt=${reportedAt} lat=${lat.toFixed(6)} lng=${lng.toFixed(6)}${accuracyText}`
          );

          window.dispatchEvent(
            new CustomEvent(LOCATION_TICK_EVENT, {
              detail: {
                lat,
                lng,
                accuracy: Number.isFinite(accuracy) ? accuracy : null,
                sentAt,
                reportedAt,
              },
            })
          );

          try {
            const liveRef = doc(db, "routes", routeId, "live", "current");
            await setDoc(
              liveRef,
              {
                uid: session.uid,
                route,
                lat,
                lng,
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
          } catch (error) {
            console.warn(
              `[SchoolWays GPS][global-5s] sentAt=${sentAt} reportedAt=${reportedAt} firestore-write-failed`
            );
          } finally {
            inFlightRef.current = false;
          }
        },
        (error) => {
          const sentAt = new Date().toISOString();
          const code = Number(error?.code);
          const message = toText(error?.message) || "unknown";
          console.warn(
            `[SchoolWays GPS][global-5s] sentAt=${sentAt} geolocation-error code=${
              Number.isFinite(code) ? code : "unknown"
            } message=${message}`
          );
          inFlightRef.current = false;
        },
        GEOLOCATION_OPTIONS
      );
    };

    tick();
    const intervalId = window.setInterval(tick, SEND_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [session.uid, session.profile]);

  return null;
}
