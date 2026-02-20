"use client";

import { useEffect, useRef, useState } from "react";

const HIDE_DELAY_MS = 5200;

export default function ForegroundPushIsland() {
  const [visible, setVisible] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const hideTimerRef = useRef(null);

  useEffect(() => {
    const clearTimer = () => {
      if (!hideTimerRef.current) return;
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    };

    const showToast = (event) => {
      const nextTitle =
        event?.detail?.title && event.detail.title.toString().trim()
          ? event.detail.title.toString().trim()
          : "SchoolWays";
      const nextBody =
        event?.detail?.body && event.detail.body.toString().trim()
          ? event.detail.body.toString().trim()
          : "Tienes una notificacion nueva.";

      setTitle(nextTitle);
      setBody(nextBody);
      setVisible(true);

      clearTimer();
      hideTimerRef.current = setTimeout(() => {
        setVisible(false);
      }, HIDE_DELAY_MS);
    };

    window.addEventListener("schoolways:push-foreground", showToast);

    return () => {
      clearTimer();
      window.removeEventListener("schoolways:push-foreground", showToast);
    };
  }, []);

  if (!visible) return null;

  return (
    <div className="push-island" role="status" aria-live="polite">
      <div className="push-island-icon" aria-hidden="true">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M12 3 2 21h20L12 3Z"
            fill="#f59e0b"
            stroke="#92400e"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path
            d="M12 9v6"
            stroke="#1f2937"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
          <circle cx="12" cy="18" r="1.2" fill="#1f2937" />
        </svg>
      </div>
      <div className="push-island-copy">
        <div className="push-island-title">{title}</div>
        <div className="push-island-body">{body}</div>
      </div>
      <button
        type="button"
        className="push-island-close"
        onClick={() => setVisible(false)}
        aria-label="Cerrar notificacion"
      >
        ×
      </button>
    </div>
  );
}
