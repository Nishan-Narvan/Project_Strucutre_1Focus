// @reviewed 2026-10-25
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { layoutDay, type StudyBlock } from "@/lib/schedule";
import { hhmm, today } from "@/lib/date";
import { Check } from "./ui";

const PX = 1.1; // pixels per minute

function useNowMinutes() {
  const [now, setNow] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      setNow(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Vertical 24h timeline: routines and events as muted background blocks, study sessions placed in free time. */
export function Timeline({ date }: { date: string }) {
  const { state, toggleSession } = useStore();
  const { fixed, study } = layoutDay(state, date);
  const now = useNowMinutes();
  const isToday = date === today();
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = isToday ? Math.max(0, now - 120) : 6 * 60 + 30;
    scroller.current?.scrollTo({ top: target * PX });
    // scroll only when the date changes, not every minute
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  return (
    <div ref={scroller} className="h-[70vh] overflow-y-auto rounded-xl border border-line bg-panel">
      <div className="relative" style={{ height: 1440 * PX }}>
        {Array.from({ length: 24 }).map((_, h) => (
          <div key={h} className="absolute inset-x-0 border-t border-line/60" style={{ top: h * 60 * PX }}>
            <span className="absolute left-2 -translate-y-1/2 bg-panel px-1 font-mono text-[10px] text-muted">{hhmm(h * 60)}</span>
          </div>
        ))}

        {fixed.map((b) => (
          <div
            key={b.id}
            className={`absolute overflow-hidden rounded-md border px-2 py-1 text-xs ${b.kind === "event" ? "left-[55%] right-2 z-[1]" : "left-14 right-2"}`}
            style={{ top: b.start * PX, height: Math.max(16, (b.end - b.start) * PX - 2), background: `${b.color}22`, borderColor: `${b.color}55`, color: b.color }}
          >
            <span className="font-medium">{b.title}</span>
            <span className="ml-2 opacity-70">
              {hhmm(b.start)}–{hhmm(b.end)}
            </span>
          </div>
        ))}

        {study.map((b, i) => (
          <StudyCard key={b.session.id + i} b={b} onToggle={() => toggleSession(b.goal.id, b.session.id)} />
        ))}

        {isToday && (
          <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: now * PX }}>
            <span className="ml-12 h-2 w-2 rounded-full bg-bad" />
            <div className="h-px flex-1 bg-bad" />
          </div>
        )}
      </div>
    </div>
  );
}

function StudyCard({ b, onToggle }: { b: StudyBlock; onToggle: () => void }) {
  const h = Math.max(22, (b.end - b.start) * PX - 2);
  return (
    <div
      className={`absolute left-16 right-3 z-[2] flex gap-2 overflow-hidden rounded-md border-l-4 bg-panel-2 px-2 py-1 shadow-lg shadow-black/30 ${b.conflict ? "outline outline-1 outline-bad" : ""} ${b.session.done ? "opacity-55" : ""}`}
      style={{ top: b.start * PX, height: h, borderLeftColor: b.goal.color }}
    >
      <div className="pt-0.5">
        <Check checked={b.session.done} onChange={onToggle} color={b.goal.color} label={`Mark ${b.task.title} done`} />
      </div>
      <div className="min-w-0 text-xs leading-tight">
        <div className={`truncate font-medium ${b.session.done ? "line-through" : ""}`}>
          {b.task.title}
          {b.parts > 1 && <span className="ml-1 text-muted">· part {b.part}/{b.parts}</span>}
        </div>
        {h > 34 && (
          <div className="truncate text-muted">
            {hhmm(b.start)}–{hhmm(b.end)} ·{" "}
            <Link href={`/goals/${b.goal.id}`} className="hover:underline" style={{ color: b.goal.color }}>
              {b.goal.title}
            </Link>{" "}
            · {b.module.title}
            {b.conflict && <span className="ml-1 text-bad">· no free slot</span>}
          </div>
        )}
      </div>
    </div>
  );
}
