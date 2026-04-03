"use client";

import { useEffect } from "react";

export const LOG_STORAGE_KEY = "schoolways:console-logs:v2";
export const LOG_EVENT_NAME = "schoolways:console-log";
const MAX_LOGS = 500;
const MAX_MESSAGE_LENGTH = 3000;
const IGNORED_LOG_PATTERNS = [
  /WebChannelConnection RPC 'Listen' stream .* transport errored/i,
  /google\.maps\.Marker is deprecated/i,
  /\[SchoolWays GPS\]\[global-\d+s?\].*geolocation-error code=3/i,
  /\[SchoolWays GPS\]\[global-\d+s?\].*geolocation-error code=2/i,
  /@firebase\/firestore:.*INTERNAL ASSERTION FAILED/i,
  /FIRESTORE.*INTERNAL ASSERTION FAILED/i,
  /@firebase\/firestore:.*INTERNAL UNHANDLED ERROR/i,
  /RestConnection RPC 'Commit'.*failed-precondition/i,
  /Firestore .*RestConnection RPC 'Commit'.*failed-precondition/i,
  /Could not reach Cloud Firestore backend/i,
  /GrpcConnection RPC 'Listen' stream .* error/i,
];

const safeStringify = (value) => {
  if (typeof value === "string") return value;
  if (value instanceof Error) {
    const stackText = value.stack ? `\n${value.stack}` : "";
    return `${value.name}: ${value.message}${stackText}`;
  }
  try {
    const json = JSON.stringify(value);
    if (typeof json === "string") return json;
  } catch (error) {
    // fallback below
  }
  return String(value);
};

const toMessage = (args) => {
  const text = args.map((part) => safeStringify(part)).join(" ");
  return text.length > MAX_MESSAGE_LENGTH
    ? `${text.slice(0, MAX_MESSAGE_LENGTH)}...`
    : text;
};

const shouldIgnoreMessage = (message) =>
  IGNORED_LOG_PATTERNS.some((pattern) => pattern.test(message));

const sanitizeLogs = (entries) => {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry) => entry && typeof entry === "object")
    .filter((entry) => !shouldIgnoreMessage(safeStringify(entry.message || "")))
    .slice(-MAX_LOGS);
};

const persistLogs = (logs) => {
  try {
    window.localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logs));
  } catch (error) {
    // ignore quota/private mode failures
  }
};

const readStoredLogs = () => {
  try {
    const raw = window.localStorage.getItem(LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const sanitized = sanitizeLogs(parsed);
    if (Array.isArray(parsed) && sanitized.length !== parsed.length) {
      persistLogs(sanitized);
    }
    return sanitized;
  } catch (error) {
    return [];
  }
};

const writeStoredLogs = (logs) => {
  persistLogs(sanitizeLogs(logs));
};

const emitLogEvent = (entry) => {
  window.dispatchEvent(new CustomEvent(LOG_EVENT_NAME, { detail: entry }));
};

const pushLogEntry = (entry) => {
  if (shouldIgnoreMessage(safeStringify(entry?.message || ""))) return;
  const current = readStoredLogs();
  current.push(entry);
  writeStoredLogs(current);
  emitLogEvent(entry);
};

const buildEntry = (level, args) => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  timestamp: new Date().toISOString(),
  level,
  path: window.location?.pathname || "/",
  message: toMessage(args),
});

export const readConsoleLogs = () => readStoredLogs();

export default function ConsoleBridge() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.__schoolwaysConsoleBridgeActive) return;
    window.__schoolwaysConsoleBridgeActive = true;

    const methods = ["log", "info", "warn", "error", "debug"];
    const originalMethods = {};

    methods.forEach((method) => {
      originalMethods[method] = console[method].bind(console);
      console[method] = (...args) => {
        try {
          const message = toMessage(args);
          if (shouldIgnoreMessage(message)) return;
          originalMethods[method](...args);
          pushLogEntry({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: new Date().toISOString(),
            level: method,
            path: window.location?.pathname || "/",
            message,
          });
        } catch (error) {
          originalMethods[method](...args);
          // keep console behavior even if persisting logs fails
        }
      };
    });

    const handleWindowError = (event) => {
      const errorText =
        event?.error instanceof Error
          ? safeStringify(event.error)
          : event?.message || "Error desconocido";
      if (shouldIgnoreMessage(errorText)) return;
      pushLogEntry(buildEntry("error", [errorText]));
    };

    const handleUnhandledRejection = (event) => {
      const message = toMessage(["UnhandledPromiseRejection", event?.reason]);
      if (shouldIgnoreMessage(message)) return;
      pushLogEntry(buildEntry("error", ["UnhandledPromiseRejection", event?.reason]));
    };

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      methods.forEach((method) => {
        if (originalMethods[method]) {
          console[method] = originalMethods[method];
        }
      });
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.__schoolwaysConsoleBridgeActive = false;
    };
  }, []);

  return null;
}
