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

const parseDurationSeconds = (value) => {
  if (typeof value === "string" && value.endsWith("s")) {
    const parsed = Number.parseFloat(value.replace("s", ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
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
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser) {
        setProfile(null);
        return;
      }

      const userRef = doc(db, "users", currentUser.uid);
      const unsubProfile = onSnapshot(userRef, (snap) => {
        setProfile(snap.exists() ? snap.data() : null);
      });

      return () => unsubProfile();
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!profile) return;
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
    const updateEtas = async () => {
      if (!profile || !busCoords) return;
      const routeKey =
        profile?.institutionCode && profile?.route
          ? `${profile.institutionCode}:${normalizeRoute(profile.route)}`
          : null;
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
          try {
            const response = await fetch("/api/routes", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                points: [
                  { lat: busCoords.lat, lng: busCoords.lng },
                  { lat: stop.coords.lat, lng: stop.coords.lng },
                ],
              }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
              return {
                title: stop.title,
                distanceKm: null,
                minutes: null,
                completed: false,
              };
            }

            const distanceMeters =
              typeof data.distanceMeters === "number" ? data.distanceMeters : null;
            const durationSeconds = parseDurationSeconds(data.duration);
            const distanceKm =
              distanceMeters !== null ? (distanceMeters / 1000).toFixed(1) : null;
            const minutes =
              durationSeconds !== null
                ? Math.max(1, Math.round(durationSeconds / 60))
                : null;
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
              distanceKm: null,
              minutes: null,
              completed: false,
            };
          }
        })
      );

      setStopEtas(results.sort((a, b) => a.order - b.order));
    };

    updateEtas();
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
