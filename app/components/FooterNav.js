"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../lib/firebaseClient";

const items = [
  { href: "/", label: "Mapa", icon: "/icons/map.png" },
  { href: "/chat", label: "Chat", icon: "/icons/chat.png" },
  { href: "/recorrido", label: "Recorrido", icon: "/icons/route.png" },
];

function normalizePath(path) {
  if (!path) return "/";
  if (path === "/") return "/";
  return path.replace(/\/+$/, "");
}

export default function FooterNav() {
  const pathname = usePathname();
  const [isAuthed, setIsAuthed] = useState(false);
  const currentPath = normalizePath(pathname);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthed(Boolean(user));
    });
    return () => unsubscribe();
  }, []);

  if (!isAuthed) return null;

  return (
    <footer className="footer-nav">
      {items.map((item) => {
        const itemPath = normalizePath(item.href);
        const isActive =
          itemPath === "/"
            ? currentPath === "/"
            : currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={isActive ? "footer-item active" : "footer-item"}
            data-active={isActive ? "true" : "false"}
            aria-current={isActive ? "page" : undefined}
          >
            <img src={item.icon} alt="" className="footer-icon" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </footer>
  );
}
