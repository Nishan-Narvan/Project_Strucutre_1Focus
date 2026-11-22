"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { OnTop } from "@/components/ui";

/**
 * A small panel under its anchor, drawn on the page's top layer (a portal) so cards below it or a
 * blurred panel around it can never cover or clip it. Closes on Escape, an outside click, or scroll.
 */
export function Popover({ anchor, open, onClose, label, width = 272, children }: { anchor: RefObject<HTMLElement | null>; open: boolean; onClose: () => void; label: string; width?: number; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const h = panel.current?.offsetHeight ?? 240;
      const below = r.bottom + 6 + h <= window.innerHeight - 8;
      setPos({
        top: below ? r.bottom + 6 : Math.max(8, r.top - 6 - h),
        left: Math.min(Math.max(8, r.left), window.innerWidth - width - 8),
      });
    };
    place();
    // measure again once the panel has its real height
    const id = requestAnimationFrame(place);
    return () => cancelAnimationFrame(id);
  }, [open, anchor, width]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const scroll = (e: Event) => !panel.current?.contains(e.target as Node) && onClose();
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;
  return (
    <OnTop>
      <div
        ref={panel}
        role="dialog"
        aria-label={label}
        className="glass fixed z-50 rounded-xl border border-line bg-bg p-1 shadow-xl shadow-black/40"
        style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}
      >
        {children}
      </div>
    </OnTop>
  );
}
