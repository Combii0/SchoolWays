"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Mapa" },
  { href: "/chat", label: "Chat" },
  { href: "/profile", label: "Cuenta" },
];

export default function TopNav() {
  const pathname = usePathname();

  return (
    <header className="nav">
      <div className="nav-brand">
        <Image src="/logo.svg" alt="SchoolWays" className="nav-logo" width={40} height={40} />
        <span>SchoolWays</span>
      </div>
      <nav className="nav-links">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={isActive ? "nav-link active" : "nav-link"}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="nav-status">
        <span className="status-pill">En vivo</span>
      </div>
    </header>
  );
}
