"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useStore } from "@/lib/store";
import { today } from "@/lib/date";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      {Array.from({ length: 8 }).map((_, i) => (
        <rect key={i} x="11" y="2" width="2" height="9" rx="1" fill="currentColor" transform={`rotate(${i * 45} 12 12)`} />
      ))}
    </svg>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { ready } = useStore();
  const nav = [
    { href: "/", label: "Dashboard", icon: "◧" },
    { href: `/day/${today()}`, label: "Today", icon: "◷", match: "/day" },
    { href: "/calendar", label: "Calendar", icon: "▦" },
    { href: "/goals/new", label: "New goal", icon: "+" },
    { href: "/routines", label: "Routines", icon: "↻" },
    { href: "/settings", label: "Settings & API key", icon: "⚙" },
  ];
  const active = (n: (typeof nav)[number]) => (n.href === "/" ? path === "/" : path.startsWith(n.match ?? n.href));

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[230px_1fr]">
      <aside className="sticky top-0 z-20 border-b border-line bg-panel/95 backdrop-blur md:h-dvh md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-4 py-3 md:py-5">
          <Logo className="h-6 w-6 text-accent" />
          <span className="font-serif text-xl">Pathwise</span>
          <span className="ml-auto rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warn md:ml-2">Demo</span>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:px-3">
          {nav.map((n) => (
            <Link
              key={n.label}
              href={n.href}
              className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                active(n) ? "bg-accent/15 text-accent" : "text-muted hover:bg-panel-2 hover:text-ink"
              }`}
            >
              <span className="w-4 text-center">{n.icon}</span>
              {n.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
        {ready ? children : <div className="animate-pulse text-muted">Loading…</div>}
      </main>
    </div>
  );
}
