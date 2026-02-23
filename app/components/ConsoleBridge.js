"use client";

import { useEffect } from "react";

export const LOG_STORAGE_KEY = "schoolways:console-logs";
export const LOG_EVENT_NAME = "schoolways:console-log";
const MAX_LOGS = 500;
const MAX_MESSAGE_LENGTH = 3000;

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

const readStoredLogs = () => {
  try {
    const raw = window.localStorage.getItem(LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
};

const writeStoredLogs = (logs) => {
  try {
    window.localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logs.slice(-MAX_LOGS)));
  } catch (error) {
    // ignore quota/private mode failures
  }
};

const emitLogEvent = (entry) => {
  window.dispatchEvent(new CustomEvent(LOG_EVENT_NAME, { detail: entry }));
};

const pushLogEntry = (entry) => {
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
        originalMethods[method](...args);
        try {
          pushLogEntry(buildEntry(method, args));
        } catch (error) {
          // keep console behavior even if persisting logs fails
        }
      };
    });

    const handleWindowError = (event) => {
      const errorText =
        event?.error instanceof Error
          ? safeStringify(event.error)
          : event?.message || "Error desconocido";
      pushLogEntry(buildEntry("error", [errorText]));
    };

    const handleUnhandledRejection = (event) => {
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
