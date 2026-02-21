"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import AuthPanel from "./components/AuthPanel";
import { auth, db } from "./lib/firebaseClient";
import { geocodeAddressToCoords } from "./lib/geocodeClient";
import {
  getRouteId,
  loadRouteStopsForProfile,
  resolveRouteKey as resolveRouteKeyFromStops,
} from "./lib/routeStops";
import {
  createStopStatusMap,
  getServiceDateKey,
  isStopAbsentStatus,
  normalizeStopKey,
} from "./lib/routeDailyStatus";

const BOGOTA = { lat: 4.711, lng: -74.0721 };

const MAP_STYLE = [
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "transit", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
];

const ZOOM_NEAR = 16;
const ZOOM_RESET = 15;
const MAX_FIT_ZOOM = 17;
const SHOW_SCHOOL_MARKER = false;
const STOP_REACHED_METERS = 180;
const ROUTE_REFRESH_INTERVAL_MS = 9000;
const ROUTE_GRADIENT_START = { r: 113, g: 210, b: 255 };
const ROUTE_GRADIENT_END = { r: 34, g: 232, b: 188 };
const MAX_GRADIENT_SEGMENTS = 96;
const ROUTE_STOPS_SUBCOLLECTIONS = ["direcciones", "addresses", "stops"];
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

let loaderPromise;

function loadGoogleMaps(apiKey) {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.google && window.google.maps) return Promise.resolve(window.google);
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise((resolve, reject) => {
    if (window.__initGoogleMaps) {
      // already loading
      return;
    }
    window.__initGoogleMaps = () => resolve(window.google);
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly&loading=async&callback=__initGoogleMaps`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Google Maps failed to load"));
    document.head.appendChild(script);
  });

  return loaderPromise;
}

function HomeContent() {
  const searchParams = useSearchParams();
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const userMarkerRef = useRef(null);
  const accuracyCircleRef = useRef(null);
  const watchIdRef = useRef(null);
  const hasActiveLocationWatchRef = useRef(false);
  const lastLocationRequestAtRef = useRef(0);
  const locationErrorCountRef = useRef(0);
  const locationRetryAfterRef = useRef(0);
  const hasCenteredRef = useRef(false);
  const lastPositionRef = useRef(null);
  const lastUploadRef = useRef(0);
  const profileRef = useRef(null);
  const geocoderRef = useRef(null);
  const schoolMarkerRef = useRef(null);
  const routeMarkersRef = useRef([]);
  const resolvedRouteStopsRef = useRef([]);
  const schoolCoordsRef = useRef(null);
  const schoolAddressRef = useRef(null);
  const completedStopsRef = useRef(new Set());
  const studentPickedUpRef = useRef(false);
  const routePolylineRef = useRef([]);
  const routeKeyRef = useRef(null);
  const routeRefreshRef = useRef({ at: 0, signature: "" });
  const monitorPushSyncRef = useRef({ at: 0, signature: "", inFlight: false });
  const geocodedStopsRef = useRef(new Map());
  const geocodingStopsRef = useRef(new Map());
  const lastStopAddressRef = useRef(null);
  const lastSchoolAddressRef = useRef(null);
  const stopReadyRef = useRef(false);
  const schoolReadyRef = useRef(false);
  const studentCodeDataRef = useRef(null);
  const studentCodeFetchRef = useRef(false);
  const loadingTimeoutRef = useRef(null);
  const updatingMarkersRef = useRef(false);
  const hasFitRef = useRef(false);
  const [pulse, setPulse] = useState(false);
  const [profile, setProfile] = useState(null);
  const [institutionAddress, setInstitutionAddress] = useState(null);
  const [institutionCoords, setInstitutionCoords] = useState(null);
  const [markersLoading, setMarkersLoading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [etaDistanceKm, setEtaDistanceKm] = useState(null);
  const [etaMinutes, setEtaMinutes] = useState(null);
  const [etaTitle, setEtaTitle] = useState("Llegada");
  const [routeStopsByKey, setRouteStopsByKey] = useState({});
  const [dailyStopStatuses, setDailyStopStatuses] = useState({});
  const userDocUnsubRef = useRef(null);
  const profileRouteSignature = profile
    ? [
        profile?.route,
        profile?.institutionCode,
        profile?.institutionAddress,
        profile?.institutionLat,
        profile?.institutionLng,
        profile?.stopAddress,
        profile?.stopLat,
        profile?.stopLng,
        profile?.studentCode,
        profile?.role,
        profile?.accountType,
      ]
        .map((value) =>
          value === null || value === undefined ? "" : value.toString().trim()
        )
        .join("|")
    : "";

  useEffect(() => {
    profileRef.current = profile;
  }, [profileRouteSignature]);

  useEffect(() => {
    schoolCoordsRef.current = institutionCoords;
  }, [institutionCoords]);

  useEffect(() => {
    schoolAddressRef.current = institutionAddress;
  }, [institutionAddress]);

  useEffect(() => {
    let cancelled = false;
    const unsubscribers = [];

    const loadRouteStops = async () => {
      if (!profile) {
        setRouteStopsByKey({});
        return null;
      }

      const loadedRoute = await loadRouteStopsForProfile(db, profile);
      if (cancelled) return;

      if (loadedRoute?.routeKey && Array.isArray(loadedRoute.stops)) {
        setRouteStopsByKey({ [loadedRoute.routeKey]: loadedRoute.stops });
        return loadedRoute;
      }

      setRouteStopsByKey({});
      return null;
    };

    const subscribeToRouteChanges = (loadedRoute) => {
      if (!loadedRoute?.sourcePath) return;
      const routePath = loadedRoute.sourcePath.split("/").filter(Boolean);
      if (routePath.length < 2) return;

      const refresh = () => {
        void loadRouteStops();
      };

      try {
        unsubscribers.push(onSnapshot(doc(db, ...routePath), refresh, () => null));
      } catch (error) {
        // ignore invalid route path subscription
      }

      ROUTE_STOPS_SUBCOLLECTIONS.forEach((collectionName) => {
        try {
          unsubscribers.push(
            onSnapshot(
              collection(db, ...routePath, collectionName),
              refresh,
              () => null
            )
          );
        } catch (error) {
          // ignore missing subcollection subscriptions
        }
      });
    };

    const initRouteStops = async () => {
      const loadedRoute = await loadRouteStops();
      if (cancelled) return;
      subscribeToRouteChanges(loadedRoute);
    };

    void initRouteStops();

    return () => {
      cancelled = true;
      unsubscribers.forEach((unsubscribe) => {
        try {
          unsubscribe();
        } catch (error) {
          // ignore
        }
      });
    };
  }, [profileRouteSignature]);

  useEffect(() => {
    if (!profile) {
      setMarkersLoading(false);
      setEtaMinutes(null);
      setEtaDistanceKm(null);
      setEtaTitle("Llegada");
      setDailyStopStatuses({});
      stopReadyRef.current = false;
      schoolReadyRef.current = !SHOW_SCHOOL_MARKER;
      lastStopAddressRef.current = null;
      lastSchoolAddressRef.current = null;
      hasFitRef.current = false;
      resolvedRouteStopsRef.current = [];
      schoolCoordsRef.current = null;
      schoolAddressRef.current = null;
      completedStopsRef.current = new Set();
      studentPickedUpRef.current = false;
      routeRefreshRef.current = { at: 0, signature: "" };
      monitorPushSyncRef.current = { at: 0, signature: "", inFlight: false };
      studentCodeDataRef.current = null;
      studentCodeFetchRef.current = false;
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
      return;
    }
    stopReadyRef.current = false;
    schoolReadyRef.current = !SHOW_SCHOOL_MARKER;
    lastStopAddressRef.current = null;
    lastSchoolAddressRef.current = null;
    hasFitRef.current = false;
    hasCenteredRef.current = false;
    setEtaMinutes(null);
    setEtaDistanceKm(null);
    setEtaTitle("Llegada");
    setDailyStopStatuses({});
    resolvedRouteStopsRef.current = [];
    schoolCoordsRef.current = null;
    schoolAddressRef.current = null;
    completedStopsRef.current = new Set();
    studentPickedUpRef.current = false;
    routeRefreshRef.current = { at: 0, signature: "" };
    monitorPushSyncRef.current = { at: 0, signature: "", inFlight: false };
    studentCodeDataRef.current = null;
    studentCodeFetchRef.current = false;
    setMarkersLoading(true);
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
    }
    loadingTimeoutRef.current = setTimeout(() => {
      setMarkersLoading(false);
      loadingTimeoutRef.current = null;
    }, 7000);
  }, [profile]);

  const resolveRouteKey = (currentProfile) =>
    resolveRouteKeyFromStops(currentProfile, routeStopsByKey);

  useEffect(() => {
    if (!profile) {
      setDailyStopStatuses({});
      return;
    }

    const routeKey = resolveRouteKey(profile);
    const routeNameFromKey = routeKey ? routeKey.split(":").slice(1).join(":") : null;
    const routeId = getRouteId(routeNameFromKey || profile.route);
    if (!routeId) {
      setDailyStopStatuses({});
      return;
    }

    const dateKey = getServiceDateKey();
    const dailyStopsRef = collection(db, "routes", routeId, "daily", dateKey, "stops");
    const unsubscribe = onSnapshot(
      dailyStopsRef,
      (snapshot) => {
        setDailyStopStatuses(createStopStatusMap(snapshot.docs));
      },
      () => {
        setDailyStopStatuses({});
      }
    );

    return () => unsubscribe();
  }, [profileRouteSignature, routeStopsByKey]);

  const getStopCoords = async (stop) => {
    if (!stop) return null;
    const lat = Number(stop?.coords?.lat);
    const lng = Number(stop?.coords?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }

    const address =
      stop?.address === null || stop?.address === undefined
        ? ""
        : stop.address.toString().trim();
    if (!address) return null;

    const key = address.toLowerCase();
    const cached = geocodedStopsRef.current.get(key);
    if (cached) return cached;

    const pending = geocodingStopsRef.current.get(key);
    if (pending) return pending;

    const request = geocodeAddressToCoords(address)
      .then((coords) => {
        if (coords) {
          geocodedStopsRef.current.set(key, coords);
        }
        return coords;
      })
      .finally(() => {
        geocodingStopsRef.current.delete(key);
      });

    geocodingStopsRef.current.set(key, request);
    return request;
  };

  const maybeUploadLocation = async (coords) => {
    try {
      const currentUser = auth.currentUser;
      const currentProfile = profileRef.current;
      if (!currentUser || !currentProfile?.route || !isMonitorProfile(currentProfile)) {
        return;
      }

      const now = Date.now();
      if (now - lastUploadRef.current < 5000) return;
      lastUploadRef.current = now;

      const routeKey = resolveRouteKey(currentProfile);
      const routeNameFromKey = routeKey ? routeKey.split(":").slice(1).join(":") : null;
      const routeId = getRouteId(routeNameFromKey || currentProfile.route);
      if (!routeId) return;

      const liveRef = doc(db, "routes", routeId, "live", "current");
      await setDoc(
        liveRef,
        {
          uid: currentUser.uid,
          route: currentProfile.route,
          lat: coords.lat,
          lng: coords.lng,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      // ignore upload errors to avoid interrupting location updates
    }
  };

  const updateMarker = (google, map, coords, options = {}) => {
    const shouldUpload = options.upload !== false;
    lastPositionRef.current = coords;

    if (!userMarkerRef.current) {
      userMarkerRef.current = createMarker(google, {
        position: coords,
        map,
        title: "Bus escolar",
        kind: "user",
      });
    } else {
      setMarkerPosition(userMarkerRef.current, coords);
    }

    if (!hasCenteredRef.current) {
      hasCenteredRef.current = true;
      map.setZoom(ZOOM_RESET);
      map.panTo(coords);
    }

    if (shouldUpload) {
      void maybeUploadLocation(coords);
    }
  };

  const parseCoord = (value) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const parseDurationSeconds = (value) => {
    if (typeof value === "string" && value.endsWith("s")) {
      const parsed = Number.parseFloat(value.replace("s", ""));
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    return null;
  };

  const fetchRoutesData = async (points, options = {}, timeoutMs = 9000) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          points,
          optimizeWaypoints: Boolean(options?.optimizeWaypoints),
        }),
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

  const decodePolyline = (encoded) => {
    if (!encoded) return [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    const coordinates = [];

    while (index < encoded.length) {
      let result = 0;
      let shift = 0;
      let byte = null;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
      lat += deltaLat;

      result = 0;
      shift = 0;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
      lng += deltaLng;

      coordinates.push({
        lat: lat / 1e5,
        lng: lng / 1e5,
      });
    }

    return coordinates;
  };

  const sumLegs = (legs, startIndex, endIndexInclusive) => {
    if (!Array.isArray(legs) || !legs.length) {
      return { distanceMeters: null, durationSeconds: null };
    }
    const start = Math.max(0, startIndex);
    const end = Math.min(legs.length - 1, endIndexInclusive);
    if (end < start) {
      return { distanceMeters: null, durationSeconds: null };
    }

    let distanceMeters = 0;
    let hasDistance = false;
    let durationSeconds = 0;
    let hasDuration = false;
    for (let index = start; index <= end; index += 1) {
      const leg = legs[index];
      if (typeof leg?.distanceMeters === "number") {
        distanceMeters += leg.distanceMeters;
        hasDistance = true;
      }
      const parsedDuration = parseDurationSeconds(leg?.duration);
      if (typeof parsedDuration === "number") {
        durationSeconds += parsedDuration;
        hasDuration = true;
      }
    }

    return {
      distanceMeters: hasDistance ? distanceMeters : null,
      durationSeconds: hasDuration ? durationSeconds : null,
    };
  };

  const clampChannel = (value) => {
    const rounded = Math.round(value);
    if (rounded < 0) return 0;
    if (rounded > 255) return 255;
    return rounded;
  };

  const interpolateColor = (start, end, t) => {
    const ratio = Math.max(0, Math.min(1, t));
    const r = clampChannel(start.r + (end.r - start.r) * ratio);
    const g = clampChannel(start.g + (end.g - start.g) * ratio);
    const b = clampChannel(start.b + (end.b - start.b) * ratio);
    return `rgb(${r}, ${g}, ${b})`;
  };

  const setRoutePolylinePath = (google, map, path, options = {}) => {
    if (!Array.isArray(path) || path.length < 2) return false;

    if (Array.isArray(routePolylineRef.current) && routePolylineRef.current.length) {
      routePolylineRef.current.forEach((polyline) => {
        polyline?.setMap?.(null);
      });
      routePolylineRef.current = [];
    }

    const lineOptions = {
      strokeOpacity: 1,
      strokeWeight: 10,
      zIndex: 2,
      geodesic: true,
      ...(options?.line || {}),
    };
    const totalSegments = path.length - 1;
    const chunkCount = Math.min(totalSegments, MAX_GRADIENT_SEGMENTS);
    const chunkSize = Math.max(1, Math.ceil(totalSegments / chunkCount));
    const created = [];

    for (let chunk = 0; chunk < chunkCount; chunk += 1) {
      const startIndex = chunk * chunkSize;
      const endIndex = Math.min((chunk + 1) * chunkSize, path.length - 1);
      if (endIndex <= startIndex) continue;

      const chunkPath = path.slice(startIndex, endIndex + 1);
      const ratio = chunkCount === 1 ? 1 : chunk / (chunkCount - 1);
      const strokeColor = interpolateColor(
        ROUTE_GRADIENT_START,
        ROUTE_GRADIENT_END,
        ratio
      );

      const polyline = new google.maps.Polyline({
        path: chunkPath,
        map,
        strokeColor,
        ...lineOptions,
      });
      created.push(polyline);
    }

    routePolylineRef.current = created;
    return created.length > 0;
  };

  const drawRouteWithDirectionsService = async (
    google,
    map,
    routeCoords,
    options = {}
  ) => {
    if (!Array.isArray(routeCoords) || routeCoords.length < 2) return false;
    const directionsService = new google.maps.DirectionsService();
    const waypoints = routeCoords.slice(1, -1).map((point) => ({
      location: point,
      stopover: true,
    }));

    return new Promise((resolve) => {
      directionsService.route(
        {
          origin: routeCoords[0],
          destination: routeCoords[routeCoords.length - 1],
          waypoints,
          optimizeWaypoints: Boolean(options?.optimizeWaypoints),
          travelMode: google.maps.TravelMode.DRIVING,
          avoidFerries: true,
        },
        (result, status) => {
          if (
            status !== "OK" ||
            !result?.routes?.[0]?.overview_path ||
            !result.routes[0].overview_path.length
          ) {
            resolve(false);
            return;
          }

          const path = result.routes[0].overview_path.map((point) => ({
            lat: point.lat(),
            lng: point.lng(),
          }));
          resolve(setRoutePolylinePath(google, map, path));
        }
      );
    });
  };

  const clearRoutePolyline = () => {
    if (Array.isArray(routePolylineRef.current) && routePolylineRef.current.length) {
      routePolylineRef.current.forEach((polyline) => {
        polyline?.setMap?.(null);
      });
      routePolylineRef.current = [];
    }
  };

  const stopLocationWatch = () => {
    if (watchIdRef.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    hasActiveLocationWatchRef.current = false;
  };

  const requestLocation = (options = {}) => {
    const force = Boolean(options?.force);
    const map = mapInstanceRef.current;
    if (!map || !window.google || !("geolocation" in navigator)) return;

    const now = Date.now();
    if (!force && now < locationRetryAfterRef.current) return;
    if (!force && hasActiveLocationWatchRef.current) return;
    if (!force && now - lastLocationRequestAtRef.current < 5000) return;
    lastLocationRequestAtRef.current = now;

    if (force) {
      stopLocationWatch();
    } else if (watchIdRef.current !== null) {
      hasActiveLocationWatchRef.current = true;
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        locationErrorCountRef.current = 0;
        locationRetryAfterRef.current = 0;
        const coords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        updateMarker(window.google, map, coords);
        void updateEta(coords);
        if (!accuracyCircleRef.current) {
          accuracyCircleRef.current = new window.google.maps.Circle({
            map,
            center: coords,
            radius: position.coords.accuracy || 0,
            fillColor: "#1a73e8",
            fillOpacity: 0.15,
            strokeColor: "#1a73e8",
            strokeOpacity: 0.3,
            strokeWeight: 1,
          });
        } else {
          accuracyCircleRef.current.setCenter(coords);
          accuracyCircleRef.current.setRadius(position.coords.accuracy || 0);
        }
      },
      (error) => {
        if (error?.code === 1) {
          // Permission denied: avoid retry storms.
          stopLocationWatch();
          locationRetryAfterRef.current = Date.now() + 5 * 60 * 1000;
          return;
        }
      },
      { enableHighAccuracy: false, maximumAge: 5000, timeout: 12000 }
    );

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        hasActiveLocationWatchRef.current = true;
        locationErrorCountRef.current = 0;
        locationRetryAfterRef.current = 0;
        const coords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        updateMarker(window.google, map, coords);
        void updateEta(coords);
        if (!accuracyCircleRef.current) {
          accuracyCircleRef.current = new window.google.maps.Circle({
            map,
            center: coords,
            radius: position.coords.accuracy || 0,
            fillColor: "#1a73e8",
            fillOpacity: 0.15,
            strokeColor: "#1a73e8",
            strokeOpacity: 0.3,
            strokeWeight: 1,
          });
        } else {
          accuracyCircleRef.current.setCenter(coords);
          accuracyCircleRef.current.setRadius(position.coords.accuracy || 0);
        }
      },
      (error) => {
        locationErrorCountRef.current += 1;
        if (error?.code === 1) {
          stopLocationWatch();
          locationRetryAfterRef.current = Date.now() + 5 * 60 * 1000;
          return;
        }
        if (locationErrorCountRef.current >= 3) {
          stopLocationWatch();
          locationRetryAfterRef.current = Date.now() + 30 * 1000;
        }
      },
      { enableHighAccuracy: false, maximumAge: 5000, timeout: 12000 }
    );
    hasActiveLocationWatchRef.current = true;
  };

  const getDirectRouteMetrics = async (from, to) => {
    if (!from || !to) {
      return { distanceMeters: null, durationSeconds: null };
    }
    const fallbackDistance = distanceMetersBetween(from, to);
    try {
      const { ok, data } = await fetchRoutesData([
        { lat: from.lat, lng: from.lng },
        { lat: to.lat, lng: to.lng },
      ]);
      if (!ok) {
        return { distanceMeters: fallbackDistance, durationSeconds: null };
      }

      const distanceMeters =
        typeof data?.distanceMeters === "number" ? data.distanceMeters : fallbackDistance;
      const durationSeconds = parseDurationSeconds(data?.duration);
      return { distanceMeters, durationSeconds };
    } catch (error) {
      return { distanceMeters: fallbackDistance, durationSeconds: null };
    }
  };

  const setEtaMetrics = ({ title, distanceMeters, durationSeconds }) => {
    setEtaTitle(title || "Llegada");
    if (typeof distanceMeters === "number" && Number.isFinite(distanceMeters)) {
      const km = distanceMeters / 1000;
      setEtaDistanceKm(km.toFixed(1));
      if (typeof durationSeconds === "number" && Number.isFinite(durationSeconds)) {
        setEtaMinutes(Math.max(1, Math.round(durationSeconds / 60)));
      } else {
        setEtaMinutes(Math.max(1, Math.round((km / 24) * 60)));
      }
      return;
    }
    setEtaDistanceKm(null);
    setEtaMinutes(null);
  };

  const syncMonitorPushEta = async ({ coords, orderedPending, legs }) => {
    if (!profile || !isMonitorProfile(profile) || !Array.isArray(orderedPending)) return;
    if (!orderedPending.length) return;

    const routeKey = resolveRouteKey(profile);
    const routeNameFromKey = routeKey ? routeKey.split(":").slice(1).join(":") : null;
    const routeId = getRouteId(routeNameFromKey || profile.route);
    if (!routeId) return;

    const stops = orderedPending.map((stop, index) => {
      const stopKey = normalizeStopKey(stop) || stop.id || `paradero-${index + 1}`;
      const statusData =
        dailyStopStatuses[stopKey] ||
        dailyStopStatuses[normalizeStopKey({ address: stop.address })] ||
        dailyStopStatuses[normalizeStopKey({ title: stop.title })] ||
        null;
      const legMetrics = sumLegs(legs, 0, index);
      const minutes =
        typeof legMetrics.durationSeconds === "number"
          ? Math.max(1, Math.round(legMetrics.durationSeconds / 60))
          : null;
      const statusValue = statusData?.status || null;

      return {
        key: stopKey,
        title: stop.title || `Paradero ${index + 1}`,
        address: stop.address || null,
        order: index,
        minutes,
        status: statusValue,
        excluded: isStopAbsentStatus(statusValue),
      };
    });

    const roundedCoords = `${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}`;
    const signature = `${routeId}:${roundedCoords}:${stops
      .map((item) => `${item.key}:${item.minutes ?? "na"}:${item.status ?? "none"}`)
      .join("|")}`;
    const now = Date.now();
    if (
      monitorPushSyncRef.current.inFlight ||
      (monitorPushSyncRef.current.signature === signature &&
        now - monitorPushSyncRef.current.at < 25000)
    ) {
      return;
    }

    monitorPushSyncRef.current = {
      at: now,
      signature,
      inFlight: true,
    };

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) return;
      const idToken = await currentUser.getIdToken();
      if (!idToken) return;

      const response = await fetch("/api/push/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          eventType: "eta_update",
          routeId,
          route: profile.route || null,
          institutionCode: profile.institutionCode || null,
          busCoords: coords,
          stops,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        console.error("Monitor ETA push sync failed", payload);
      }
    } catch (error) {
      console.error("Monitor ETA push sync request failed", error);
    } finally {
      monitorPushSyncRef.current = {
        ...monitorPushSyncRef.current,
        inFlight: false,
      };
    }
  };

  const resolveStudentStopCoords = async (currentProfile) => {
    if (!currentProfile) return null;
    const stopLat = parseCoord(currentProfile.stopLat);
    const stopLng = parseCoord(currentProfile.stopLng);
    if (stopLat !== null && stopLng !== null) {
      return { lat: stopLat, lng: stopLng };
    }

    const stopAddress = toLowerText(currentProfile.stopAddress)
      ? currentProfile.stopAddress.toString().trim()
      : "";
    if (!stopAddress) return null;
    const query = stopAddress.includes("Bogotá")
      ? stopAddress
      : `${stopAddress}, Bogotá, Colombia`;
    return geocodeAddressToCoords(query);
  };

  const findStopByAddressOrCoords = (stops, address, coords) => {
    const normalizedAddress = toLowerText(address);
    const byAddress = normalizedAddress
      ? stops.find(
          (stop) =>
            toLowerText(stop?.address) === normalizedAddress ||
            toLowerText(stop?.title) === normalizedAddress
        )
      : null;
    if (byAddress) return byAddress;
    if (!coords) return null;
    return (
      stops.find((stop) => {
        const distance = distanceMetersBetween(stop?.coords, coords);
        return typeof distance === "number" && distance <= STOP_REACHED_METERS;
      }) || null
    );
  };

  const updateEta = async (coords, options = {}) => {
    if (!coords || !profile) return;

    const resolvedStops = Array.isArray(resolvedRouteStopsRef.current)
      ? resolvedRouteStopsRef.current
      : [];
    const schoolCoords = schoolCoordsRef.current;
    const schoolAddress = schoolAddressRef.current;
    const routeKey = resolveRouteKey(profile) || "route";
    const rounded = `${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}`;
    const signature = `${routeKey}:${rounded}:${resolvedStops.length}:${
      schoolCoords ? `${schoolCoords.lat.toFixed(4)},${schoolCoords.lng.toFixed(4)}` : "no-school"
    }`;

    const now = Date.now();
    if (
      !options?.force &&
      routeRefreshRef.current.signature === signature &&
      now - routeRefreshRef.current.at < ROUTE_REFRESH_INTERVAL_MS
    ) {
      return;
    }
    routeRefreshRef.current = { at: now, signature };

    resolvedStops.forEach((stop) => {
      const distance = distanceMetersBetween(coords, stop.coords);
      if (typeof distance === "number" && distance <= STOP_REACHED_METERS) {
        completedStopsRef.current.add(stop.id);
      }
    });
    const pendingStops = resolvedStops.filter(
      (stop) => !completedStopsRef.current.has(stop.id)
    );

    const targetSchool = schoolCoords
      ? schoolCoords
      : schoolAddress
        ? await geocodeAddressToCoords(schoolAddress)
        : null;

    if (!pendingStops.length && !targetSchool) {
      setEtaMetrics({ title: "Llegada", distanceMeters: null, durationSeconds: null });
      return;
    }

    const points = [{ lat: coords.lat, lng: coords.lng }];
    pendingStops.forEach((stop) => {
      points.push({ lat: stop.coords.lat, lng: stop.coords.lng });
    });
    if (targetSchool) {
      points.push({ lat: targetSchool.lat, lng: targetSchool.lng });
    }

    let routeData = null;
    if (points.length >= 2) {
      try {
        const { ok, data } = await fetchRoutesData(points, {
          optimizeWaypoints: Boolean(targetSchool && pendingStops.length > 1),
        });
        if (ok) {
          routeData = data;
        }
      } catch (error) {
        routeData = null;
      }
    }

    const optimizedIndexes = Array.isArray(routeData?.optimizedIntermediateWaypointIndex)
      ? routeData.optimizedIntermediateWaypointIndex
      : [];
    const orderedPending =
      targetSchool && optimizedIndexes.length === pendingStops.length
        ? optimizedIndexes
            .map((index) => pendingStops[index])
            .filter(Boolean)
        : pendingStops;
    const legs = Array.isArray(routeData?.legs) ? routeData.legs : [];

    if (routeData?.encodedPolyline && window.google && mapInstanceRef.current) {
      const path = decodePolyline(routeData.encodedPolyline);
      if (path.length) {
        setRoutePolylinePath(window.google, mapInstanceRef.current, path);
      }
    }

    if (isMonitorProfile(profile)) {
      if (orderedPending.length) {
        void syncMonitorPushEta({ coords, orderedPending, legs });
        const firstLeg = sumLegs(legs, 0, 0);
        let distanceMeters = firstLeg.distanceMeters;
        let durationSeconds = firstLeg.durationSeconds;
        if (distanceMeters === null) {
          const direct = await getDirectRouteMetrics(coords, orderedPending[0].coords);
          distanceMeters = direct.distanceMeters;
          durationSeconds = direct.durationSeconds;
        }
        setEtaMetrics({
          title: "Siguiente paradero",
          distanceMeters,
          durationSeconds,
        });
        return;
      }

      if (targetSchool) {
        const toSchool = await getDirectRouteMetrics(coords, targetSchool);
        setEtaMetrics({
          title: "Llegada al colegio",
          distanceMeters: toSchool.distanceMeters,
          durationSeconds: toSchool.durationSeconds,
        });
        return;
      }

      setEtaMetrics({ title: "Llegada", distanceMeters: null, durationSeconds: null });
      return;
    }

    const studentCoords = await resolveStudentStopCoords(profile);
    const studentStop = findStopByAddressOrCoords(
      resolvedStops,
      profile.stopAddress,
      studentCoords
    );
    if (studentStop) {
      const distanceToStudent = distanceMetersBetween(coords, studentStop.coords);
      if (typeof distanceToStudent === "number" && distanceToStudent <= STOP_REACHED_METERS) {
        completedStopsRef.current.add(studentStop.id);
      }
    }

    if (studentCoords) {
      const distanceToOwnStop = distanceMetersBetween(coords, studentCoords);
      if (
        typeof distanceToOwnStop === "number" &&
        distanceToOwnStop <= STOP_REACHED_METERS
      ) {
        studentPickedUpRef.current = true;
      }
    }

    const isPickedUp =
      studentPickedUpRef.current ||
      (studentStop ? completedStopsRef.current.has(studentStop.id) : false);
    if (isPickedUp) {
      studentPickedUpRef.current = true;
    }
    if (!isPickedUp) {
      const studentIndex = orderedPending.findIndex(
        (stop) => stop.id === studentStop?.id
      );
      if (studentIndex >= 0) {
        const etaToStudent = sumLegs(legs, 0, studentIndex);
        setEtaMetrics({
          title: "Llegada a tu paradero",
          distanceMeters: etaToStudent.distanceMeters,
          durationSeconds: etaToStudent.durationSeconds,
        });
        return;
      }

      const directStudent = await getDirectRouteMetrics(coords, studentCoords);
      setEtaMetrics({
        title: "Llegada a tu paradero",
        distanceMeters: directStudent.distanceMeters,
        durationSeconds: directStudent.durationSeconds,
      });
      return;
    }

    if (targetSchool) {
      if (legs.length) {
        const toSchool = sumLegs(legs, 0, legs.length - 1);
        setEtaMetrics({
          title: "Llegada al colegio",
          distanceMeters: toSchool.distanceMeters,
          durationSeconds: toSchool.durationSeconds,
        });
        return;
      }

      const directSchool = await getDirectRouteMetrics(coords, targetSchool);
      setEtaMetrics({
        title: "Llegada al colegio",
        distanceMeters: directSchool.distanceMeters,
        durationSeconds: directSchool.durationSeconds,
      });
      return;
    }

    setEtaMetrics({ title: "Llegada", distanceMeters: null, durationSeconds: null });
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        if (userDocUnsubRef.current) {
          userDocUnsubRef.current();
          userDocUnsubRef.current = null;
        }
        setProfile(null);
        setInstitutionAddress(null);
        setInstitutionCoords(null);
        return;
      }

      const userRef = doc(db, "users", currentUser.uid);
      if (userDocUnsubRef.current) {
        userDocUnsubRef.current();
      }

      userDocUnsubRef.current = onSnapshot(
        userRef,
        async (snap) => {
          let data = snap.exists() ? snap.data() : null;
          if (data?.studentCode && (!data.stopAddress || !data.institutionCode)) {
            const codeRef = doc(db, "studentCodes", data.studentCode);
            const codeSnap = await getDoc(codeRef);
            if (codeSnap.exists()) {
              const codeData = codeSnap.data();
              const merged = {
                ...data,
                stopAddress: data.stopAddress || codeData.stopAddress || null,
                institutionCode:
                  data.institutionCode || codeData.institutionCode || null,
                institutionName:
                  data.institutionName || codeData.institutionName || null,
                institutionAddress:
                  data.institutionAddress || codeData.institutionAddress || null,
                route: data.route || codeData.route || null,
                studentName: data.studentName || codeData.studentName || null,
                stopLat: data.stopLat || codeData.stopLat || null,
                stopLng: data.stopLng || codeData.stopLng || null,
                institutionLat:
                  data.institutionLat || codeData.institutionLat || null,
                institutionLng:
                  data.institutionLng || codeData.institutionLng || null,
              };
              data = merged;
              await setDoc(userRef, merged, { merge: true });
            }
          }

          setProfile(data);

          if (data?.institutionCode) {
            const instRef = doc(db, "institutions", data.institutionCode);
            const instSnap = await getDoc(instRef);
            if (instSnap.exists()) {
              const instData = instSnap.data();
              const lat = parseCoord(instData.lat);
              const lng = parseCoord(instData.lng);
              setInstitutionAddress(
                instData.address || data.institutionAddress || null
              );
              if (lat !== null && lng !== null) {
                setInstitutionCoords({ lat, lng });
              } else {
                setInstitutionCoords(null);
              }
            } else {
              setInstitutionAddress(null);
              setInstitutionCoords(null);
            }
          } else {
            setInstitutionAddress(null);
            setInstitutionCoords(null);
          }
        },
        () => {
          // ignore
        }
      );
    });

    return () => {
      unsubscribe();
      if (userDocUnsubRef.current) {
        userDocUnsubRef.current();
        userDocUnsubRef.current = null;
      }
    };
  }, []);

  const geocodeAddress = async (google, address) => {
    const apiCoords = await geocodeAddressToCoords(address);
    if (apiCoords) {
      return new google.maps.LatLng(apiCoords.lat, apiCoords.lng);
    }

    if (!geocoderRef.current) {
      geocoderRef.current = new google.maps.Geocoder();
    }
    return new Promise((resolve) => {
      geocoderRef.current.geocode({ address }, (results, status) => {
        if (status === "OK" && results && results[0]) {
          if (typeof window !== "undefined") {
            const loc = results[0].geometry.location;
            window.localStorage.setItem(
              `geocode:${address}`,
              JSON.stringify({ lat: loc.lat(), lng: loc.lng() })
            );
          }
          resolve(results[0].geometry.location);
        } else {
          resolve(null);
        }
      });
    });
  };

  const createMarker = (google, { position, map, title, kind }) => {
    const isBusMarker = kind === "user";
    const markerZIndex = isBusMarker ? 9999 : 120;
    const AdvancedMarker = google.maps?.marker?.AdvancedMarkerElement;
    if (AdvancedMarker && map?.getMapId && map.getMapId()) {
      try {
        const content = document.createElement("div");
        if (isBusMarker) {
          content.className = "marker-bus-shell";
          const image = document.createElement("img");
          image.src = "/icons/bus.png";
          image.alt = "";
          image.className = "marker-bus-image";
          image.decoding = "async";
          image.loading = "eager";
          content.appendChild(image);
        } else {
          content.className =
            kind === "school" ? "marker-dot marker-school" : "marker-dot marker-stop";
        }
        return new AdvancedMarker({
          map,
          position,
          title,
          content,
          zIndex: markerZIndex,
        });
      } catch (err) {
        // Fall back to classic marker when advanced markers fail by environment.
      }
    }

    const icon =
      isBusMarker
        ? {
            url: "/icons/bus.png",
            scaledSize: new google.maps.Size(64, 64),
            anchor: new google.maps.Point(32, 32),
          }
        : kind === "school"
          ? {
              url: "https://maps.google.com/mapfiles/ms/icons/green-dot.png",
            }
        : {
            url: "https://maps.google.com/mapfiles/ms/icons/red-dot.png",
          };

    return new google.maps.Marker({
      position,
      map,
      title,
      icon,
      zIndex: markerZIndex,
    });
  };

  const setMarkerMap = (marker, map) => {
    if (!marker) return;
    if ("map" in marker) {
      marker.map = map;
    } else if (typeof marker.setMap === "function") {
      marker.setMap(map);
    }
  };

  const setMarkerPosition = (marker, position) => {
    if (!marker) return;
    if ("position" in marker) {
      marker.position = position;
    } else if (typeof marker.setPosition === "function") {
      marker.setPosition(position);
    }
  };

  const updateRouteMarkers = async () => {
    const map = mapInstanceRef.current;
    if (!map || !window.google || !profile || updatingMarkersRef.current) {
      return;
    }
    updatingMarkersRef.current = true;

    try {
      const google = window.google;
      if (
        profile.studentCode &&
        !studentCodeDataRef.current &&
        !studentCodeFetchRef.current
      ) {
        studentCodeFetchRef.current = true;
        try {
          const codeRef = doc(db, "studentCodes", profile.studentCode);
          const codeSnap = await getDoc(codeRef);
          if (codeSnap.exists()) {
            studentCodeDataRef.current = codeSnap.data();
          }
        } catch (err) {
          studentCodeDataRef.current = null;
        } finally {
          studentCodeFetchRef.current = false;
        }
      }

      const stopAddress =
        profile.stopAddress || studentCodeDataRef.current?.stopAddress || null;
      const stopStatusMap = dailyStopStatuses || {};
      const schoolAddress =
        institutionAddress ||
        profile.institutionAddress ||
        studentCodeDataRef.current?.institutionAddress ||
        null;
      const stopLat = parseCoord(
        profile.stopLat ?? studentCodeDataRef.current?.stopLat
      );
      const stopLng = parseCoord(
        profile.stopLng ?? studentCodeDataRef.current?.stopLng
      );
      const stopCoords =
        stopLat !== null && stopLng !== null
          ? new google.maps.LatLng(stopLat, stopLng)
          : null;
      if (!stopCoords && stopAddress) {
        // ignore
      }
      const schoolLat = parseCoord(
        institutionCoords?.lat ??
          profile.institutionLat ??
          studentCodeDataRef.current?.institutionLat
      );
      const schoolLng = parseCoord(
        institutionCoords?.lng ??
          profile.institutionLng ??
          studentCodeDataRef.current?.institutionLng
      );
      let schoolCoords =
        schoolLat !== null && schoolLng !== null
          ? new google.maps.LatLng(schoolLat, schoolLng)
          : null;
      if (!schoolCoords && schoolAddress) {
        const query = schoolAddress.includes("Bogotá")
          ? schoolAddress
          : `${schoolAddress}, Bogotá, Colombia`;
        schoolCoords = await geocodeAddress(google, query);
      }
      schoolCoordsRef.current = schoolCoords
        ? { lat: schoolCoords.lat(), lng: schoolCoords.lng() }
        : null;
      schoolAddressRef.current = schoolAddress;

      const updateLoadingState = () => {
        const needsStop = Boolean(stopCoords || stopAddress);
        const stopReady = !needsStop || stopReadyRef.current;
        if (stopReady) {
          setMarkersLoading(false);
          if (loadingTimeoutRef.current) {
            clearTimeout(loadingTimeoutRef.current);
            loadingTimeoutRef.current = null;
          }

          if (!hasFitRef.current) {
            const bounds = new google.maps.LatLngBounds();
            if (routeMarkersRef.current.length) {
              routeMarkersRef.current.forEach((marker) => {
                if (marker?.position) {
                  bounds.extend(marker.position);
                } else if (typeof marker.getPosition === "function") {
                  bounds.extend(marker.getPosition());
                }
              });
            }
            if (lastPositionRef.current) {
              bounds.extend(lastPositionRef.current);
            }
            if (!bounds.isEmpty()) {
              map.fitBounds(bounds, 60);
              const listener = google.maps.event.addListenerOnce(
                map,
                "idle",
                () => {
                  if (map.getZoom() > MAX_FIT_ZOOM) {
                    map.setZoom(MAX_FIT_ZOOM);
                  }
                }
              );
              if (!listener) {
                if (map.getZoom() > MAX_FIT_ZOOM) {
                  map.setZoom(MAX_FIT_ZOOM);
                }
              }
              hasFitRef.current = true;
            }
          }
        }
      };

      const routeKey = resolveRouteKey(profile);
      const routeStops = routeKey ? routeStopsByKey[routeKey] : null;
      // no logging
      const stopCandidates = [];
      const ownAddressKey = normalizeStopKey({
        address: stopAddress,
        title: "Paradero",
      });
      const matchedRouteStop = (routeStops || []).find(
        (item) =>
          toLowerText(item?.address) &&
          toLowerText(item?.address) === toLowerText(stopAddress)
      );
      const ownStopKey = normalizeStopKey(matchedRouteStop) || ownAddressKey;
      const ownStopStatus = ownStopKey ? stopStatusMap[ownStopKey]?.status : null;
      const ownStopIsAbsent = isStopAbsentStatus(ownStopStatus);
      if (stopCoords) {
        if (!ownStopIsAbsent) {
          stopCandidates.push({
            id: ownStopKey || "student-stop",
            title: "Paradero",
            address: stopAddress,
            coords: stopCoords,
          });
        }
      } else if (stopAddress) {
        if (!ownStopIsAbsent) {
          stopCandidates.push({
            id: ownStopKey || "student-stop",
            title: "Paradero",
            address: stopAddress,
          });
        }
      }

      if (routeStops?.length) {
        routeStops.forEach((stop, index) => {
          const stopKey = normalizeStopKey(stop);
          const stopStatus = stopKey ? stopStatusMap[stopKey]?.status : null;
          if (isStopAbsentStatus(stopStatus)) return;
          stopCandidates.push({
            id: stopKey || stop.id || `paradero-${index + 1}`,
            title: stop.title || `Paradero ${index + 1}`,
            address: stop.address || null,
            coords: stop.coords
              ? new google.maps.LatLng(stop.coords.lat, stop.coords.lng)
              : null,
          });
        });
      }

      const coordsList = [];
      for (const candidate of stopCandidates) {
        if (candidate.coords) {
          coordsList.push({
            id: candidate.id || candidate.title,
            coords: candidate.coords,
            title: candidate.title,
            address: candidate.address || null,
          });
          continue;
        }
        if (candidate.address) {
          const query = candidate.address.includes("Bogotá")
            ? candidate.address
            : `${candidate.address}, Bogotá, Colombia`;
          const coords = await geocodeAddress(google, query);
          if (coords) {
            coordsList.push({
              id: candidate.id || candidate.title,
              coords,
              title: candidate.title,
              address: candidate.address,
            });
          }
        }
      }

      if (coordsList.length) {
        const uniqueById = new Map();
        coordsList.forEach((item) => {
          const key =
            item.address?.toLowerCase() ||
            `${item.coords.lat().toFixed(6)},${item.coords.lng().toFixed(6)}`;
          if (!uniqueById.has(key)) {
            uniqueById.set(key, item);
          }
        });
        const resolvedList = Array.from(uniqueById.values());
        resolvedRouteStopsRef.current = resolvedList.map((item, index) => ({
          id: item.id || `paradero-${index + 1}`,
          title: item.title || `Paradero ${index + 1}`,
          address: item.address || null,
          coords: {
            lat: item.coords.lat(),
            lng: item.coords.lng(),
          },
        }));

        routeMarkersRef.current.forEach((marker) => setMarkerMap(marker, null));
        routeMarkersRef.current = resolvedList.map((item) => {
          return createMarker(google, {
            position: item.coords,
            map,
            title: item.title,
            kind: "stop",
          });
        });

        if (SHOW_SCHOOL_MARKER && schoolCoords) {
          if (!schoolMarkerRef.current) {
            schoolMarkerRef.current = createMarker(google, {
              position: schoolCoords,
              map,
              title: "Colegio",
              kind: "school",
            });
          } else {
            setMarkerPosition(schoolMarkerRef.current, schoolCoords);
            setMarkerMap(schoolMarkerRef.current, map);
          }
        } else if (schoolMarkerRef.current) {
          setMarkerMap(schoolMarkerRef.current, null);
        }

        stopReadyRef.current = true;
        updateLoadingState();

        const routeCoords = resolvedList.map((item) => item.coords);
        const pointsForRoute = routeCoords.map((point) => ({
          lat: point.lat(),
          lng: point.lng(),
        }));
        if (schoolCoords) {
          pointsForRoute.push({ lat: schoolCoords.lat(), lng: schoolCoords.lng() });
        }
        const optimizeWaypoints = pointsForRoute.length > 3;
        const routeSignature = routeCoords
          .map((point) => `${point.lat().toFixed(6)},${point.lng().toFixed(6)}`)
          .join("|") + (schoolCoords ? `|school:${schoolCoords.lat().toFixed(6)},${schoolCoords.lng().toFixed(6)}` : "");
        const routeRenderKey = `${routeKey || "route"}:${routeSignature}:${optimizeWaypoints ? "opt" : "plain"}`;

        if (
          pointsForRoute.length >= 2 &&
          (routeKeyRef.current !== routeRenderKey ||
            !Array.isArray(routePolylineRef.current) ||
            routePolylineRef.current.length === 0)
        ) {
          routeKeyRef.current = routeRenderKey;
          let routeDrawn = false;
          try {
            const { ok, data } = await fetchRoutesData(pointsForRoute, {
              optimizeWaypoints,
            });
            if (ok && data?.encodedPolyline) {
              const path = decodePolyline(data.encodedPolyline);
              if (path.length) {
                routeDrawn = setRoutePolylinePath(google, map, path);
              }
            }
          } catch (err) {
            routeDrawn = false;
          }

          if (!routeDrawn) {
            routeDrawn = await drawRouteWithDirectionsService(
              google,
              map,
              pointsForRoute.map(
                (point) => new google.maps.LatLng(point.lat, point.lng)
              ),
              { optimizeWaypoints }
            );
          }

          if (!routeDrawn) {
            clearRoutePolyline();
            routeKeyRef.current = null;
          }
        }

        if (!hasFitRef.current) {
          const bounds = new google.maps.LatLngBounds();
          resolvedList.forEach((item) => bounds.extend(item.coords));
          if (schoolCoords) {
            bounds.extend(schoolCoords);
          }
          if (lastPositionRef.current) {
            bounds.extend(lastPositionRef.current);
          }
          if (!bounds.isEmpty()) {
            map.fitBounds(bounds, 60);
            hasFitRef.current = true;
          }
        }
      }
      if (!coordsList.length) {
        routeMarkersRef.current.forEach((marker) => setMarkerMap(marker, null));
        routeMarkersRef.current = [];
        resolvedRouteStopsRef.current = [];
        if (schoolMarkerRef.current) {
          setMarkerMap(schoolMarkerRef.current, null);
        }
        clearRoutePolyline();
      }

      if (lastPositionRef.current) {
        void updateEta(lastPositionRef.current, { force: true });
      }
    } finally {
      updatingMarkersRef.current = false;
    }
  };

  useEffect(() => {
    const targetStop = searchParams?.get("stop");
    if (!targetStop || !profile || !mapReady) return;
    const routeKey = resolveRouteKey(profile);
    const routeStops = routeKey ? routeStopsByKey[routeKey] : null;
    if (!routeStops?.length) return;
    const stop = routeStops.find(
      (item) => item.title.toLowerCase() === targetStop.toLowerCase()
    );
    if (!stop) return;

    const map = mapInstanceRef.current;
    if (!map || !window.google) return;
    const google = window.google;

    const centerOnStop = async () => {
      let coords = null;
      if (stop.coords) {
        coords = new google.maps.LatLng(stop.coords.lat, stop.coords.lng);
      } else if (stop.address) {
        coords = await geocodeAddress(google, stop.address);
      }
      if (!coords) return;
      map.setZoom(17);
      map.panTo(coords);
    };

    void centerOnStop();
  }, [searchParams, profile, mapReady, routeStopsByKey]);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) return;

    let isMounted = true;

    loadGoogleMaps(apiKey)
      .then((google) => {
        if (!google || !mapRef.current || !isMounted) return;
        if (mapInstanceRef.current) return;

        const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;
        const map = new google.maps.Map(mapRef.current, {
          center: BOGOTA,
          zoom: ZOOM_NEAR,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          mapId: mapId || undefined,
        });

        mapInstanceRef.current = map;
        setMapReady(true);

        map.addListener("idle", () => {
          try {
            const center = map.getCenter();
            if (!center) return;
            const payload = {
              lat: center.lat(),
              lng: center.lng(),
              zoom: map.getZoom(),
            };
            window.localStorage.setItem("schoolways:mapState", JSON.stringify(payload));
          } catch (err) {
            // ignore
          }
        });
      })
      .catch(() => null);

    return () => {
      isMounted = false;
      stopLocationWatch();
    };
  }, []);

  useEffect(() => {
    if (!profile || !mapReady) return;
    updateRouteMarkers();
    if (mapInstanceRef.current && window.google?.maps) {
      window.google.maps.event.trigger(mapInstanceRef.current, "resize");
    }
  }, [profile, mapReady, routeStopsByKey, dailyStopStatuses]);

  useEffect(() => {
    if (!profile || !mapReady) return;
    if (isMonitorProfile(profile)) {
      requestLocation();
      return;
    }
    stopLocationWatch();
  }, [profile, mapReady]);

  useEffect(() => {
    if (!profile || !mapReady || !window.google) return;

    const map = mapInstanceRef.current;
    if (!map) return;

    const routeKey = resolveRouteKey(profile);
    const routeNameFromKey = routeKey ? routeKey.split(":").slice(1).join(":") : null;
    const routeId = getRouteId(routeNameFromKey || profile.route);
    if (!routeId) return;

    const routeStops = routeKey ? routeStopsByKey[routeKey] : null;
    const initFirstStop = async () => {
      if (lastPositionRef.current || !routeStops?.length) return;
      const firstWithCoords = routeStops.find((stop) => stop?.coords) || routeStops[0];
      const firstCoords = await getStopCoords(firstWithCoords);
      if (!firstCoords) return;
      updateMarker(window.google, map, firstCoords, { upload: false });
      void updateEta(firstCoords, { force: true });
    };
    void initFirstStop();

    const liveRef = doc(db, "routes", routeId, "live", "current");
    const unsubscribe = onSnapshot(liveRef, (snap) => {
      const data = snap.exists() ? snap.data() : null;
      const lat = parseCoord(data?.lat);
      const lng = parseCoord(data?.lng);

      if (lat !== null && lng !== null) {
        const coords = { lat, lng };
        updateMarker(window.google, map, coords, { upload: false });
        void updateEta(coords);
        return;
      }
    });

    return () => unsubscribe();
  }, [profile, mapReady, routeStopsByKey]);

  useEffect(() => {
    updateRouteMarkers();
  }, [profile, institutionAddress, institutionCoords, routeStopsByKey, dailyStopStatuses]);

  useEffect(() => {
    if (!profile) return;
    if (!Object.keys(routeStopsByKey).length) return;
    if (!lastPositionRef.current) return;
    void updateEta(lastPositionRef.current, { force: true });
  }, [profile, routeStopsByKey, dailyStopStatuses]);

  useEffect(() => {
    if (!profile) return;
    const interval = setInterval(() => {
      if (
        !stopReadyRef.current ||
        !schoolReadyRef.current ||
        !Array.isArray(routePolylineRef.current) ||
        routePolylineRef.current.length === 0
      ) {
        updateRouteMarkers();
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [profile, institutionAddress, institutionCoords, routeStopsByKey, dailyStopStatuses]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (markersLoading) {
      map.setOptions({
        draggable: false,
        keyboardShortcuts: false,
        gestureHandling: "none",
      });
    } else if (mapReady) {
      map.setOptions({
        draggable: true,
        keyboardShortcuts: true,
        gestureHandling: "greedy",
      });
    }
  }, [markersLoading, mapReady]);

  const handleCenter = () => {
    const map = mapInstanceRef.current;
    const position = lastPositionRef.current;
    if (!map) return;
    if (position) {
      map.setZoom(ZOOM_NEAR);
      map.panTo(position);
      setPulse(true);
      window.setTimeout(() => setPulse(false), 600);
      return;
    }

    if (profile && isMonitorProfile(profile)) {
      // For monitor, center on fresh device location if cache is missing.
      requestLocation({ force: true });
    }
    if (userMarkerRef.current) {
      const markerPos =
        userMarkerRef.current.position ||
        (typeof userMarkerRef.current.getPosition === "function"
          ? userMarkerRef.current.getPosition()
          : null);
      if (markerPos) {
        map.setZoom(ZOOM_NEAR);
        map.panTo(markerPos);
        setPulse(true);
        window.setTimeout(() => setPulse(false), 600);
      }
    }
  };

  return (
    <main className="map-page">
      <AuthPanel />
      {markersLoading ? (
        <div className="map-loading-overlay" role="status" aria-live="polite">
          <div className="map-loading-card">
            <div className="map-loading-spinner" />
            <div className="map-loading-text">Cargando paraderos...</div>
          </div>
        </div>
      ) : null}
      <div
        ref={mapRef}
        className={profile ? "map-surface" : "map-surface hidden"}
        aria-label="Mapa"
      />
      {profile ? (
        <div className="eta-bubble" aria-live="polite">
          <div className="eta-bubble-inner">
            <div className="eta-title">{etaTitle}</div>
            <div className="eta-metric">
              {etaMinutes !== null ? `${etaMinutes} min` : "--"}
            </div>
            <div className="eta-sub">
              {etaDistanceKm !== null ? `${etaDistanceKm} km` : "-- km"}
            </div>
          </div>
        </div>
      ) : null}
      <button
        type="button"
        className={pulse ? "map-control pulse" : "map-control"}
        onClick={handleCenter}
        aria-label="Centrar en mi ubicación"
        title="Centrar"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="12" cy="12" r="3.5" stroke="#1b2430" strokeWidth="2" />
          <path
            d="M12 3v3M12 18v3M3 12h3M18 12h3"
            stroke="#1b2430"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <main className="map-page">
          <AuthPanel />
        </main>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
