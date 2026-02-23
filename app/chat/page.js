"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import {
  LOG_EVENT_NAME,
  LOG_STORAGE_KEY,
  readConsoleLogs,
} from "../components/ConsoleBridge";
import { auth, db } from "../lib/firebaseClient";

const toLowerText = (value) =>
  value === null || value === undefined ? "" : value.toString().trim().toLowerCase();

const isMonitorProfile = (profile) => {
  if (!profile || typeof profile !== "object") return true;
  const role = toLowerText(profile.role);
  const accountType = toLowerText(profile.accountType);
  const userType = toLowerText(profile.userType);
  const profileType = toLowerText(profile.profileType);
  const type = toLowerText(profile.type);
  const candidates = [role, accountType, userType, profileType, type].filter(Boolean);
  const isExplicitMonitor = candidates.some(
    (value) => value === "monitor" || value === "monitora"
  );
  if (isExplicitMonitor) return true;

  const isExplicitStudent = candidates.some(
    (value) => value === "student" || value === "estudiante" || value === "alumno"
  );
  if (isExplicitStudent) return false;

  const hasMonitorSignals = Boolean(profile.route) && Boolean(
    profile.institutionCode || profile.institutionName
  );
  if (hasMonitorSignals) return true;

  const hasMonitorKeyword =
    role.includes("monitor") ||
    accountType.includes("monitor") ||
    userType.includes("monitor") ||
    profileType.includes("monitor") ||
    type.includes("monitor");
  if (hasMonitorKeyword) return true;

  // Fallback: if we cannot classify as student, allow Logs access.
  return true;
};

const levelClass = (level) => {
  if (level === "error") return "logs-entry level-error";
  if (level === "warn") return "logs-entry level-warn";
  if (level === "debug") return "logs-entry level-debug";
  return "logs-entry";
};

export default function LogsPage() {
  const [authReady, setAuthReady] = useState(false);
  const [isMonitor, setIsMonitor] = useState(false);
  const [logs, setLogs] = useState(() =>
    typeof window === "undefined" ? [] : readConsoleLogs()
  );
  const orderedLogs = useMemo(() => [...logs].reverse(), [logs]);

  useEffect(() => {
    let unsubscribeProfile = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setAuthReady(false);
      setIsMonitor(false);
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (!user) {
        setAuthReady(true);
        return;
      }

      unsubscribeProfile = onSnapshot(
        doc(db, "users", user.uid),
        (snapshot) => {
          const profile = snapshot.exists() ? snapshot.data() : null;
          setIsMonitor(isMonitorProfile(profile));
          setAuthReady(true);
        },
        () => {
          setIsMonitor(false);
          setAuthReady(true);
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

    const handleIncomingLog = (event) => {
      const entry = event?.detail;
      if (!entry || typeof entry !== "object") return;
      setLogs((prev) => [...prev, entry].slice(-500));
    };

    const handleStorageUpdate = (event) => {
      if (event?.key === LOG_STORAGE_KEY) {
        setLogs(readConsoleLogs());
      }
    };

    window.addEventListener(LOG_EVENT_NAME, handleIncomingLog);
    window.addEventListener("storage", handleStorageUpdate);

    return () => {
      window.removeEventListener(LOG_EVENT_NAME, handleIncomingLog);
      window.removeEventListener("storage", handleStorageUpdate);
    };
  }, []);

  const clearLogs = () => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(LOG_STORAGE_KEY);
    setLogs([]);
  };

  if (!authReady) {
    return (
      <main className="logs-page">
        <section className="logs-card">
          <h1>Logs</h1>
          <p>Cargando permisos...</p>
        </section>
      </main>
    );
  }

  if (!auth.currentUser) {
    return (
      <main className="logs-page">
        <section className="logs-card">
          <h1>Logs</h1>
          <p>Inicia sesion para continuar.</p>
        </section>
      </main>
    );
  }

  if (!isMonitor) {
    return (
      <main className="logs-page">
        <section className="logs-card">
          <h1>Logs</h1>
          <p>Solo la monitora puede ver esta seccion.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="logs-page">
      <section className="logs-card">
        <div className="logs-toolbar">
          <div>
            <h1>Logs</h1>
            <p>{logs.length} mensajes capturados</p>
          </div>
          <button type="button" className="logs-clear-btn" onClick={clearLogs}>
            Limpiar
          </button>
        </div>

        {!orderedLogs.length ? (
          <div className="logs-empty">
            Todavia no hay mensajes. Ve al mapa/recorrido y vuelve para ver trazas.
          </div>
        ) : (
          <div className="logs-list">
            {orderedLogs.map((entry) => (
              <article className={levelClass(entry.level)} key={entry.id}>
                <div className="logs-meta">
                  <span>[{entry.level || "log"}]</span>
                  <span>{entry.timestamp || "-"}</span>
                  <span>{entry.path || "/"}</span>
                </div>
                <pre>{entry.message || ""}</pre>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
