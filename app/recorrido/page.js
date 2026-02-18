"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import AuthPanel from "../components/AuthPanel";
import { auth, db } from "../lib/firebaseClient";

const ROUTE_STOPS = {
  "L1kj2HG3fd4SA5:ruta 1": [
    {
      title: "Calle 96 #45a 40",
      address: "Calle 96 #45a 40, Bogotá, Colombia",
      coords: { lat: 4.6851812, lng: -74.058837 },
    },
    {
      title: "Cafam La Floresta",
      address: "Cafam La Floresta, Bogotá, Colombia",
      coords: { lat: 4.68633, lng: -74.07406 },
    },
    {
      title: "Carrera 50a #122 - 90",
      address: "Carrera 50a #122 - 90, Bogotá, Colombia",
      coords: null,
    },
    {
      title: "Unicentro",
      address: "Unicentro, Bogotá, Colombia",
      coords: { lat: 4.7022, lng: -74.0415 },
    },
  ],
};

const normalizeRoute = (route) => {
  if (!route) return "";
  return route
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
};

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

const parseDurationSeconds = (value) => {
  if (typeof value === "string" && value.endsWith("s")) {
    const parsed = Number.parseFloat(value.replace("s", ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return null;
};

const fetchRoutesData = async (points, timeoutMs = 9000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, data };
  } catch (error) {
    return { ok: false, data: {} };
  } finally {
    clearTimeout(timeoutId);
  }
};

const getRouteId = (route) => {
  if (!route) return null;
  return route
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
};

const resolveRouteKey = (profile) => {
  if (!profile) return null;
  const institutionCode = profile?.institutionCode?.toString().trim();
  const normalizedRoute = normalizeRoute(profile?.route);

  if (institutionCode && normalizedRoute) {
    const exact = `${institutionCode}:${normalizedRoute}`;
    if (ROUTE_STOPS[exact]) return exact;
  }

  const keys = Object.keys(ROUTE_STOPS);

  if (institutionCode) {
    const byInstitution = keys.filter((key) =>
      key.startsWith(`${institutionCode}:`)
    );
    if (byInstitution.length === 1) return byInstitution[0];
  }

  if (normalizedRoute) {
    const byRoute = keys.filter((key) => key.endsWith(`:${normalizedRoute}`));
    if (byRoute.length === 1) return byRoute[0];
  }

  if (keys.length === 1) return keys[0];
  return null;
};

export default function RecorridoPage() {
  const [profile, setProfile] = useState(null);
  const [busCoords, setBusCoords] = useState(null);
  const [stopEtas, setStopEtas] = useState([]);
  const watchIdRef = useRef(null);
  const lastFetchRef = useRef(0);
  const router = useRouter();

  useEffect(() => {
    let unsubscribeProfile = null;
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }
      if (!currentUser) {
        setProfile(null);
        setBusCoords(null);
        setStopEtas([]);
        return;
      }

      const userRef = doc(db, "users", currentUser.uid);
      unsubscribeProfile = onSnapshot(
        userRef,
        (snap) => {
          setProfile(snap.exists() ? snap.data() : null);
        },
        () => {
          setProfile(null);
        }
      );
    });

    return () => {
      if (unsubscribeProfile) {
        unsubscribeProfile();
      }
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!profile) return;
    if (!isMonitorProfile(profile)) return;
    if (!("geolocation" in navigator)) return;

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setBusCoords({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => null,
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    if (isMonitorProfile(profile)) return;

    const routeKey = resolveRouteKey(profile);
    const routeNameFromKey = routeKey ? routeKey.split(":")[1] : null;
    const routeId = getRouteId(profile.route || routeNameFromKey);
    if (!routeId) return;

    const routeStops = routeKey ? ROUTE_STOPS[routeKey] : null;
    const firstStop = routeStops?.find((stop) => stop?.coords)?.coords;
    if (firstStop) {
      setBusCoords((prev) =>
        prev ? prev : { lat: firstStop.lat, lng: firstStop.lng }
      );
    }

    const liveRef = doc(db, "routes", routeId, "live", "current");
    const unsubLive = onSnapshot(liveRef, (snap) => {
      const data = snap.exists() ? snap.data() : null;
      const lat = Number(data?.lat);
      const lng = Number(data?.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        setBusCoords({ lat, lng });
        return;
      }
    });

    return () => unsubLive();
  }, [profile]);

  useEffect(() => {
    const updateEtas = async () => {
      if (!profile || !busCoords) return;
      const routeKey = resolveRouteKey(profile);
      const routeStops = routeKey ? ROUTE_STOPS[routeKey] : null;
      if (!routeStops?.length) {
        setStopEtas([]);
        return;
      }

      const now = Date.now();
      if (now - lastFetchRef.current < 30000) return;
      lastFetchRef.current = now;

      const results = await Promise.all(
        routeStops.map(async (stop, index) => {
          if (!stop.coords) {
            return {
              title: stop.title,
              order: index,
              distanceKm: null,
              minutes: null,
              completed: false,
            };
          }

          const fallbackMeters = distanceMetersBetween(busCoords, stop.coords);
          const fallbackMinutes = Number.isFinite(fallbackMeters)
            ? Math.max(1, Math.round(((fallbackMeters / 1000) / 24) * 60))
            : null;

          try {
            const { ok, data } = await fetchRoutesData([
              { lat: busCoords.lat, lng: busCoords.lng },
              { lat: stop.coords.lat, lng: stop.coords.lng },
            ]);
            if (!ok) {
              return {
                title: stop.title,
                order: index,
                distanceKm:
                  Number.isFinite(fallbackMeters)
                    ? (fallbackMeters / 1000).toFixed(1)
                    : null,
                minutes: fallbackMinutes,
                completed: Number.isFinite(fallbackMeters)
                  ? fallbackMeters <= 200
                  : false,
              };
            }

            const distanceMeters =
              typeof data.distanceMeters === "number"
                ? data.distanceMeters
                : fallbackMeters;
            const durationSeconds = parseDurationSeconds(data.duration);
            const distanceKm =
              distanceMeters !== null ? (distanceMeters / 1000).toFixed(1) : null;
            const minutes =
              durationSeconds !== null
                ? Math.max(1, Math.round(durationSeconds / 60))
                : fallbackMinutes;
            const completed =
              distanceMeters !== null ? distanceMeters <= 200 : false;

            return {
              title: stop.title,
              order: index,
              distanceKm,
              minutes,
              completed,
            };
          } catch (err) {
            return {
              title: stop.title,
              order: index,
              distanceKm:
                Number.isFinite(fallbackMeters)
                  ? (fallbackMeters / 1000).toFixed(1)
                  : null,
              minutes: fallbackMinutes,
              completed: Number.isFinite(fallbackMeters)
                ? fallbackMeters <= 200
                : false,
            };
          }
        })
      );

      setStopEtas(results.sort((a, b) => a.order - b.order));
    };

    updateEtas();
  }, [profile, busCoords]);

  useEffect(() => {
    if (!profile || busCoords) return;
    const routeKey = resolveRouteKey(profile);
    const routeStops = routeKey ? ROUTE_STOPS[routeKey] : null;
    if (!routeStops?.length) return;
    setStopEtas((prev) => {
      if (prev.length) return prev;
      return routeStops.map((stop, index) => ({
        title: stop.title,
        order: index,
        distanceKm: null,
        minutes: null,
        completed: false,
      }));
    });
  }, [profile, busCoords]);

  if (!profile) {
    return (
      <main className="map-page">
        <AuthPanel />
      </main>
    );
  }

  const nextIndex = stopEtas.findIndex((stop) => !stop.completed);

  return (
    <main className="route-page">
      <div className="route-overlay">
        <AuthPanel />
        <header className="route-header">
          <h1>Recorrido</h1>
          <p>Tiempo estimado hasta cada paradero.</p>
        </header>
        <div className="route-list">
          {stopEtas.length ? (
            stopEtas.map((stop, index) => (
              <details
                key={stop.title}
                className={[
                  "route-item",
                  "route-item-detail",
                  stop.completed ? "completed" : "",
                  index === nextIndex ? "next" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <summary className="route-item-summary">
                  <div className="route-item-info">
                    <div className="route-item-title">{stop.title}</div>
                    <div className="route-item-meta">
                      {stop.minutes !== null ? `${stop.minutes} min` : "-- min"} ·{" "}
                      {stop.distanceKm !== null
                        ? `${stop.distanceKm} km`
                        : "-- km"}
                    </div>
                  </div>
                  <div className="route-item-status">
                    {stop.completed ? (
                      <span className="route-check">✓</span>
                    ) : (
                      <span className="route-pending">•</span>
                    )}
                  </div>
                </summary>
                <div className="route-item-actions">
                  <button
                    type="button"
                    className="route-item-button"
                    onClick={() => {
                      const target = encodeURIComponent(stop.title);
                      router.push(`/?stop=${target}`);
                    }}
                  >
                    Ver paradero
                  </button>
                </div>
              </details>
            ))
          ) : (
            <div className="route-empty">Cargando recorrido...</div>
          )}
        </div>
      </div>
    </main>
  );
}
