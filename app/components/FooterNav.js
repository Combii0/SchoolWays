"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../lib/firebaseClient";
import { isMonitorProfile } from "../lib/profileRoles";

const ITEMS = [
  { href: "/", label: "Mapa", icon: "/icons/map.png" },
  { href: "/chat", label: "Logs", icon: "/icons/chat.png" },
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
  const [isMonitor, setIsMonitor] = useState(false);
  const currentPath = normalizePath(pathname);

  useEffect(() => {
    let unsubscribeProfile = null;

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthed(Boolean(user));
      setIsMonitor(false);

      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (!user) {
        return;
      }

      unsubscribeProfile = onSnapshot(
        doc(db, "users", user.uid),
        (snapshot) => {
          const profile = snapshot.exists() ? snapshot.data() : null;
          setIsMonitor(isMonitorProfile(profile));
        },
        () => {
          setIsMonitor(false);
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

  if (!isAuthed) return null;

  const visibleItems = ITEMS.filter((item) => item.href !== "/chat" || isMonitor);

  return (
    <footer
      className="footer-nav"
      style={{ gridTemplateColumns: `repeat(${visibleItems.length}, minmax(0, 1fr))` }}
    >
      {visibleItems.map((item) => {
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
            <Image src={item.icon} alt="" className="footer-icon" width={20} height={20} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </footer>
  );
}
