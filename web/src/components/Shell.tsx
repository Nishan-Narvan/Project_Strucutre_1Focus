"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useStore } from "@/lib/store";
import { AgentBot } from "@/components/AgentBot";
import { AccountBox, AccountGate, Notice } from "@/components/AccountGate";
import { QuickLook } from "@/components/Appearance";

/** Where MyLife mark: a path that bends through three waypoints, the last one lit. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M4 20 C 4 12, 20 14, 20 6" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <circle cx="4" cy="20" r="2" fill="currentColor" />
      <circle cx="12" cy="13" r="2" fill="currentColor" />
      <circle cx="20" cy="5" r="2.4" fill="var(--color-crystal)" style={{ filter: "drop-shadow(0 0 3px var(--glow))" }} />
    </svg>
  );
}

const NAV = [
  { href: "/goals", label: "Goals" },
  { href: "/today", label: "Today" },
  { href: "/calendar", label: "Calendar" },
  { href: "/notes", label: "Notes" },
  { href: "/routines", label: "Routines" },
  { href: "/settings", label: "Settings" },
];

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { ready } = useStore();
  // Until signed in and set up, the account screens replace the whole app
  if (!ready) return <AccountGate />;
  const active = (n: (typeof NAV)[number]) => {
    if (n.href === "/today") return path === "/today" || path.startsWith("/day");
    return path.startsWith(n.href);
  };

  return (
    // Two solid panels on the wall: the side panel and the main panel
    <div className="min-h-dvh md:grid md:grid-cols-[232px_1fr] md:gap-3 md:p-3">
      <aside className="sticky top-0 z-20 flex flex-col border-b border-line bg-bg md:top-3 md:h-[calc(100dvh-1.5rem)] md:rounded-[22px] md:border">
        <Link href="/goals" className="flex items-center gap-2.5 px-5 py-4 md:py-6">
          <Logo className="h-6 w-6 text-ink" />
          <span className="font-serif text-xl leading-none whitespace-nowrap">Where MyLife</span>
        </Link>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n) ? "page" : undefined}
              className={`shrink-0 rounded-[10px] px-3 py-2 text-sm transition-colors ${active(n) ? "bg-panel-2 font-medium text-ink" : "text-muted hover:bg-panel-2/60 hover:text-ink"}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto hidden space-y-5 border-t border-line p-4 md:block">
          <QuickLook />
          <AccountBox />
        </div>
      </aside>
      {/* Bottom padding keeps page content clear of the assistant's button */}
      <main className="min-w-0 md:min-h-[calc(100dvh-1.5rem)] md:rounded-[22px] md:border md:border-line md:bg-bg">
        <div className="mx-auto w-full max-w-[1160px] px-4 pt-6 pb-28 md:px-10 md:pt-10">{children}</div>
      </main>
      <AgentBot />
      <Notice />
    </div>
  );
}
