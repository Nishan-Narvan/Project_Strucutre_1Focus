"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useStore } from "@/lib/store";

/** Pathwise mark: a path that bends through three waypoints, the last one lit. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M4 20 C 4 12, 20 14, 20 6" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <circle cx="4" cy="20" r="2" fill="currentColor" />
      <circle cx="12" cy="13" r="2" fill="currentColor" />
      <circle cx="20" cy="5" r="2.4" fill="#bfe9ff" style={{ filter: "drop-shadow(0 0 3px #bfe9ff)" }} />
    </svg>
  );
}

const NAV = [
  { href: "/", label: "Today" },
  { href: "/goals", label: "Goals", exact: true },
  { href: "/goals/new", label: "New goal" },
  { href: "/calendar", label: "Calendar" },
  { href: "/routines", label: "Routines" },
  { href: "/settings", label: "Settings" },
];

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { ready } = useStore();
  const active = (n: (typeof NAV)[number]) => {
    if (n.href === "/") return path === "/" || path.startsWith("/day");
    if (n.href === "/goals") return path === "/goals" || (path.startsWith("/goals/") && path !== "/goals/new");
    return path.startsWith(n.href);
  };

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[216px_1fr]">
      <aside className="sticky top-0 z-20 border-b border-line bg-black md:h-dvh md:border-r md:border-b-0">
        <Link href="/" className="flex items-center gap-2.5 px-5 py-4 md:py-6">
          <Logo className="h-6 w-6 text-ink" />
          <span className="font-serif text-2xl leading-none">Pathwise</span>
        </Link>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`shrink-0 rounded-lg px-3 py-2 text-sm transition ${active(n) ? "bg-panel-2 text-ink" : "text-muted hover:text-ink"}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <p className="hidden px-5 pt-6 text-xs leading-relaxed text-faint md:block">Demo data. Nothing leaves this browser yet.</p>
      </aside>
      <main className="mx-auto w-full max-w-[1200px] px-4 py-6 md:px-10 md:py-10">
        {ready ? children : <div className="text-muted">Loading…</div>}
      </main>
    </div>
  );
}
