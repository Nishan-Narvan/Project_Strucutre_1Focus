"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { layoutDay, type StudyBlock } from "@/lib/schedule";
import { hhmm, today } from "@/lib/date";
import { CompleteButton } from "./ui";

const PX = 1.1; // pixels per minute

export function useNowMinutes() {
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

/** The study block to do next today: first unfinished block that hasn't ended. */
export function nextBlock(study: StudyBlock[], date: string, now: number) {
  if (date !== today()) return study.find((b) => !b.session.done);
  return study.find((b) => !b.session.done && b.end > now) ?? study.find((b) => !b.session.done);
}

/** Vertical 24h timeline: routines as quiet fills, events dashed, study sessions placed in free time. */
export function Timeline({ date, className = "h-[68vh]" }: { date: string; className?: string }) {
  const { state, completeSession, reopenSession } = useStore();
  const { fixed, study } = layoutDay(state, date);
  const now = useNowMinutes();
  const isToday = date === today();
  const next = nextBlock(study, date, now);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = isToday ? Math.max(0, now - 90) : 6 * 60 + 30;
    scroller.current?.scrollTo({ top: target * PX });
    // scroll only when the date changes, not every minute
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  return (
    <div ref={scroller} className={`${className} overflow-y-auto rounded-[10px] border border-line bg-panel`}>
      <div className="relative" style={{ height: 1440 * PX }}>
        {Array.from({ length: 24 }).map((_, h) => (
          <div key={h} className="absolute inset-x-0 border-t border-line/70" style={{ top: h * 60 * PX }}>
            <span className="absolute left-3 top-1 text-[11px] text-faint">{hhmm(h * 60)}</span>
          </div>
        ))}

        {fixed.map((b) => (
          <div
            key={b.id}
            className={`absolute overflow-hidden rounded-md px-2.5 py-1 text-xs ${
              b.kind === "event" ? "left-[58%] right-2 z-[1] border border-dashed border-muted bg-black text-ink" : "left-16 right-2 bg-panel-2 text-muted"
            }`}
            style={{ top: b.start * PX + 1, height: Math.max(18, (b.end - b.start) * PX - 2) }}
          >
            {b.title}
            <span className="ml-2 text-faint">
              {hhmm(b.start)}–{hhmm(b.end)}
            </span>
          </div>
        ))}

        {study.map((b, i) => (
          <StudyCard
            key={b.session.id + i}
            b={b}
            current={next?.session.id === b.session.id}
            onComplete={(note) => completeSession(b.goal.id, b.session.id, note)}
            onReopen={() => reopenSession(b.goal.id, b.session.id)}
          />
        ))}

        {isToday && (
          <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: now * PX }}>
            <span className="crystal-dot ml-[58px] h-2 w-2 rounded-full" />
            <div className="h-px flex-1 bg-crystal shadow-[0_0_8px_#bfe9ff]" />
          </div>
        )}
      </div>
    </div>
  );
}

function StudyCard({ b, current, onComplete, onReopen }: { b: StudyBlock; current: boolean; onComplete: (n: string) => void; onReopen: () => void }) {
  const h = Math.max(26, (b.end - b.start) * PX - 3);
  return (
    <div
      className={`absolute left-[72px] right-4 z-[2] flex gap-2.5 overflow-hidden rounded-md border px-2.5 py-1.5 ${
        current ? "crystal-ring border-crystal/60 bg-[#0d1418]" : "border-line bg-[#1c1c1c]"
      } ${b.conflict ? "outline outline-1 outline-bad" : ""} ${b.session.done ? "opacity-50" : ""}`}
      style={{ top: b.start * PX + 1.5, height: h }}
    >
      <div className="pt-px">
        <CompleteButton done={b.session.done} current={current} title={b.task.title} onComplete={onComplete} onReopen={onReopen} size="h-4 w-4" />
      </div>
      <div className="min-w-0 text-xs leading-snug">
        <div className={`truncate font-medium ${b.session.done ? "line-through" : current ? "crystal-text" : "text-ink"}`}>
          {b.task.title}
          {b.parts > 1 && <span className="ml-1 font-normal text-muted">(part {b.part} of {b.parts})</span>}
        </div>
        {h > 38 && (
          <div className="truncate text-muted">
            {hhmm(b.start)}–{hhmm(b.end)},{" "}
            <Link href={`/goals/${b.goal.id}`} className="hover:text-ink hover:underline">
              {b.goal.title}
            </Link>
            {b.conflict && <span className="ml-1 text-bad">no free slot</span>}
          </div>
        )}
      </div>
    </div>
  );
}
