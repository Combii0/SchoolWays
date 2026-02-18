"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import AuthPanel from "./components/AuthPanel";
import { auth, db } from "./lib/firebaseClient";

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

const getRouteKeys = () => Object.keys(ROUTE_STOPS);
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
  const hasCenteredRef = useRef(false);
  const lastPositionRef = useRef(null);
  const lastUploadRef = useRef(0);
  const profileRef = useRef(null);
  const geocoderRef = useRef(null);
  const stopMarkerRef = useRef(null);
  const schoolMarkerRef = useRef(null);
  const routeMarkersRef = useRef([]);
  const routePolylineRef = useRef(null);
  const routeKeyRef = useRef(null);
  const etaLastFetchRef = useRef(0);
  const etaKeyRef = useRef(null);
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
  const userDocUnsubRef = useRef(null);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    if (!profile) {
      setMarkersLoading(false);
      stopReadyRef.current = false;
      schoolReadyRef.current = !SHOW_SCHOOL_MARKER;
      lastStopAddressRef.current = null;
      lastSchoolAddressRef.current = null;
      hasFitRef.current = false;
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

  const getRouteId = (route) => {
    if (!route) return null;
    return route
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  };

  const normalizeRoute = (route) => {
    if (!route) return "";
    return route
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  };

  const resolveRouteKey = (currentProfile) => {
    if (!currentProfile) return null;
    const institutionCode = currentProfile?.institutionCode?.toString().trim();
    const normalizedRoute = normalizeRoute(currentProfile?.route);

    if (institutionCode && normalizedRoute) {
      const exact = `${institutionCode}:${normalizedRoute}`;
      if (ROUTE_STOPS[exact]) return exact;
    }

    const keys = getRouteKeys();

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

    // Current project has one configured route, so fallback keeps map functional.
    if (keys.length === 1) return keys[0];

    return null;
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

      const routeId = getRouteId(currentProfile.route);
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
        title: "Tu ubicación",
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

  const setRoutePolylinePath = (google, map, path, options = {}) => {
    if (!Array.isArray(path) || path.length < 2) return false;
    const baseStyle = {
      strokeColor: "#5aa9ff",
      strokeOpacity: 0.85,
      strokeWeight: 6,
    };
    const style = { ...baseStyle, ...options };
    if (!routePolylineRef.current) {
      routePolylineRef.current = new google.maps.Polyline({
        path,
        map,
        ...style,
      });
      return true;
    }
    routePolylineRef.current.setPath(path);
    routePolylineRef.current.setMap(map);
    routePolylineRef.current.setOptions(style);
    return true;
  };

  const drawRouteWithDirectionsService = async (google, map, routeCoords) => {
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
          optimizeWaypoints: false,
          travelMode: google.maps.TravelMode.DRIVING,
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

  const requestLocation = () => {
    const map = mapInstanceRef.current;
    if (!map || !window.google) return;

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
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
      () => null,
      { enableHighAccuracy: true }
    );

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
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
      () => null,
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  };

  const updateEta = async (coords) => {
    if (!coords || !profile) return;
    const routeKey = resolveRouteKey(profile);
    const routeStops = routeKey ? ROUTE_STOPS[routeKey] : null;
    const destinationStop = routeStops?.[routeStops.length - 1];
    if (!destinationStop?.coords) return;

    const now = Date.now();
    if (now - etaLastFetchRef.current < 30000 && etaKeyRef.current === routeKey) {
      return;
    }
    etaLastFetchRef.current = now;
    etaKeyRef.current = routeKey;

    const fallbackDistance = distanceMetersBetween(coords, destinationStop.coords);
    const applyFallbackEta = () => {
      if (!Number.isFinite(fallbackDistance)) return;
      const km = fallbackDistance / 1000;
      // 24 km/h average urban bus speed to keep ETA realistic when API is unavailable.
      const minutes = Math.max(1, Math.round((km / 24) * 60));
      setEtaDistanceKm(km.toFixed(1));
      setEtaMinutes(minutes);
    };

    try {
      const { ok, data } = await fetchRoutesData([
        { lat: coords.lat, lng: coords.lng },
        { lat: destinationStop.coords.lat, lng: destinationStop.coords.lng },
      ]);
      if (!ok) {
        applyFallbackEta();
        return;
      }

      const distanceMeters =
        typeof data.distanceMeters === "number" ? data.distanceMeters : null;
      const durationSeconds = parseDurationSeconds(data.duration);

      if (distanceMeters !== null) {
        setEtaDistanceKm((distanceMeters / 1000).toFixed(1));
      } else if (Number.isFinite(fallbackDistance)) {
        setEtaDistanceKm((fallbackDistance / 1000).toFixed(1));
      }
      if (durationSeconds !== null) {
        setEtaMinutes(Math.max(1, Math.round(durationSeconds / 60)));
      } else {
        applyFallbackEta();
      }
    } catch (err) {
      applyFallbackEta();
    }
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
    if (typeof window !== "undefined") {
      const cached = window.localStorage.getItem(`geocode:${address}`);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (
            typeof parsed?.lat === "number" &&
            typeof parsed?.lng === "number"
          ) {
            return new google.maps.LatLng(parsed.lat, parsed.lng);
          }
        } catch (err) {
          // ignore cache parse errors
        }
      }
    }

    try {
      const response = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (response.ok) {
        const data = await response.json();
        if (typeof window !== "undefined") {
          window.localStorage.setItem(
            `geocode:${address}`,
            JSON.stringify({ lat: data.lat, lng: data.lng })
          );
        }
        return new google.maps.LatLng(data.lat, data.lng);
      }
    } catch (err) {
      // ignore
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
    const AdvancedMarker = google.maps?.marker?.AdvancedMarkerElement;
    if (AdvancedMarker && map?.getMapId && map.getMapId()) {
      try {
        const content = document.createElement("div");
        content.className =
          kind === "user" ? "marker-dot marker-user" : "marker-dot marker-stop";
        return new AdvancedMarker({
          map,
          position,
          title,
          content,
        });
      } catch (err) {
        // Fall back to classic marker when advanced markers fail by environment.
      }
    }

    const icon =
      kind === "user"
        ? {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 6,
            fillColor: "#1a73e8",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2.5,
          }
        : {
            url: "https://maps.google.com/mapfiles/ms/icons/red-dot.png",
          };

    return new google.maps.Marker({
      position,
      map,
      title,
      icon,
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
      const schoolAddress = null;
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
      const schoolCoords = null;

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
      const routeStops = routeKey ? ROUTE_STOPS[routeKey] : null;
      // no logging
      const stopCandidates = [];
      if (stopCoords) {
        stopCandidates.push({ title: "Paradero", coords: stopCoords });
      } else if (stopAddress) {
        stopCandidates.push({
          title: "Paradero",
          address: stopAddress,
        });
      }

      if (routeStops?.length) {
        routeStops.forEach((stop, index) => {
          stopCandidates.push({
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
          coordsList.push({ coords: candidate.coords, title: candidate.title });
          continue;
        }
        if (candidate.address) {
          const query = candidate.address.includes("Bogotá")
            ? candidate.address
            : `${candidate.address}, Bogotá, Colombia`;
          const coords = await geocodeAddress(google, query);
          if (coords) {
            coordsList.push({ coords, title: candidate.title });
          }
        }
      }

      if (coordsList.length) {
        routeMarkersRef.current.forEach((marker) => setMarkerMap(marker, null));
        routeMarkersRef.current = coordsList.map((item) => {
          return createMarker(google, {
            position: item.coords,
            map,
            title: item.title,
            kind: "stop",
          });
        });

        stopReadyRef.current = true;
        updateLoadingState();

        if (
          routeStops?.length >= 2 &&
          (routeKeyRef.current !== routeKey || !routePolylineRef.current)
        ) {
          routeKeyRef.current = routeKey;
          const routeCoords = coordsList.map((item) => item.coords);
          if (routeCoords.length >= 2) {
            let routeDrawn = false;
            try {
              const { ok, data } = await fetchRoutesData(
                routeCoords.map((point) => ({
                  lat: point.lat(),
                  lng: point.lng(),
                }))
              );
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
                routeCoords
              );
            }

            if (!routeDrawn) {
              const fallbackPath = routeCoords.map((point) => ({
                lat: point.lat(),
                lng: point.lng(),
              }));
              setRoutePolylinePath(google, map, fallbackPath, {
                strokeOpacity: 0.75,
                strokeWeight: 5,
              });
              routeKeyRef.current = null;
            }
          }
        }

        if (!hasFitRef.current) {
          const bounds = new google.maps.LatLngBounds();
          coordsList.forEach((item) => bounds.extend(item.coords));
          if (lastPositionRef.current) {
            bounds.extend(lastPositionRef.current);
          }
          if (!bounds.isEmpty()) {
            map.fitBounds(bounds, 60);
            hasFitRef.current = true;
          }
        }
      }

      // School marker disabled for now to isolate stop marker performance.
    } finally {
      updatingMarkersRef.current = false;
    }
  };

  useEffect(() => {
    const targetStop = searchParams?.get("stop");
    if (!targetStop || !profile || !mapReady) return;
    const routeKey = resolveRouteKey(profile);
    const routeStops = routeKey ? ROUTE_STOPS[routeKey] : null;
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
  }, [searchParams, profile, mapReady]);

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
      if (watchIdRef.current !== null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!profile || !mapReady) return;
    if (isMonitorProfile(profile)) {
      requestLocation();
    }
    updateRouteMarkers();
    if (mapInstanceRef.current && window.google?.maps) {
      window.google.maps.event.trigger(mapInstanceRef.current, "resize");
    }
  }, [profile, mapReady]);

  useEffect(() => {
    if (!profile || !mapReady || !window.google) return;
    if (isMonitorProfile(profile)) return;

    const map = mapInstanceRef.current;
    if (!map) return;

    const routeKey = resolveRouteKey(profile);
    const routeNameFromKey = routeKey ? routeKey.split(":")[1] : null;
    const routeId = getRouteId(profile.route || routeNameFromKey);
    if (!routeId) return;

    const routeStops = routeKey ? ROUTE_STOPS[routeKey] : null;
    const firstStop = routeStops?.find((stop) => stop?.coords)?.coords;
    if (firstStop && !lastPositionRef.current) {
      const coords = { lat: firstStop.lat, lng: firstStop.lng };
      updateMarker(window.google, map, coords, { upload: false });
      void updateEta(coords);
    }

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
  }, [profile, mapReady]);

  useEffect(() => {
    updateRouteMarkers();
  }, [profile, institutionAddress, institutionCoords]);

  useEffect(() => {
    if (!profile) return;
    const interval = setInterval(() => {
      if (
        !stopReadyRef.current ||
        !schoolReadyRef.current ||
        !routePolylineRef.current
      ) {
        updateRouteMarkers();
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [profile, institutionAddress, institutionCoords]);

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
      requestLocation();
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
            <div className="eta-title">Llegada</div>
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
