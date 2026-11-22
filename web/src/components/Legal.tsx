import Link from "next/link";
import type { ReactNode } from "react";

/** Public pages (privacy, terms): readable without signing in, outside the app's panels. */
export const PUBLIC_PATHS = ["/privacy", "/terms"];

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:py-16">
      <Link href="/goals" className="font-serif text-xl">Where MyLife</Link>
      <h1 className="mt-8 font-serif text-4xl leading-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted">Last updated {updated}</p>
      <div className="mt-8 space-y-6 text-[15px] leading-7 text-ink/90 [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink [&_li]:mt-1.5 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
      <p className="mt-12 flex gap-4 border-t border-line pt-6 text-sm text-muted">
        <Link href="/privacy" className="hover:text-ink">Privacy</Link>
        <Link href="/terms" className="hover:text-ink">Terms</Link>
        <Link href="/goals" className="hover:text-ink">Open the app</Link>
      </p>
    </main>
  );
}
