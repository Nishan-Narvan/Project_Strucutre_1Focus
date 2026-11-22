"use client";

import { useEffect, useRef, useState } from "react";
import { progress, taskSessions } from "@/lib/schedule";
import { fmtDate, fmtDuration } from "@/lib/date";
import { shortPhaseTitle, splitPhaseTitle } from "@/lib/phaseTitle";
import type { Goal } from "@/lib/types";

const H = 330; // sideways road height
const LANES = [118, 214]; // nodes alternate between two lanes

type Stop = { label: string; title: string; spent: number; total: number; tasksDone: number; tasks: number; done: boolean; current: boolean; ratio: number };

/**
 * The roadmap as a winding road running sideways, sized to fit its box so it never scrolls; with many
 * phases the stops and their text get smaller. Each stop shows time put in of the total and tasks done of the total.
 */
export function Road({ goal, selected, onSelect }: { goal: Goal; selected: number; onSelect: (i: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const p = progress(goal);
  const stops: Stop[] = goal.roadmap.modules.map((m, i) => {
    const mp = p.modules[i];
    const done = mp.ratio >= 1;
    return {
      label: splitPhaseTitle(m.title).label ?? `Phase ${i + 1}`,
      title: shortPhaseTitle(m.title),
      spent: mp.done,
      total: mp.total,
      tasksDone: m.tasks.filter((t) => {
        const s = taskSessions(goal, t.id);
        return s.length > 0 && s.every((x) => x.done);
      }).length,
      tasks: m.tasks.length,
      done,
      current: i === p.currentModule && !done,
      ratio: mp.ratio,
    };
  });
  const n = stops.length;
  const allDone = stops.every((s) => s.done);
  const finish = { target: goal.targetLevel, by: fmtDate(goal.deadline, { day: "numeric", month: "short" }) };

  // Sideways needs room for each label: two steps apart on the same lane
  const pad = Math.min(84, Math.max(48, w / (n + 1) / 2));
  const step = w ? (w - pad * 2) / Math.max(n, 1) : 0;

  return (
    <div ref={box} className="rounded-[10px] border border-line bg-panel">
      {w === 0 ? (
        <div style={{ height: H }} />
      ) : (
        <Sideways stops={stops} w={w} step={step} pad={pad} selected={selected} onSelect={onSelect} allDone={allDone} finish={finish} />
      )}
    </div>
  );
}

function Sideways({ stops, w, step, pad, selected, onSelect, allDone, finish }: { stops: Stop[]; w: number; step: number; pad: number; selected: number; onSelect: (i: number) => void; allDone: boolean; finish: { target: string; by: string } }) {
  const n = stops.length;
  const mini = step * 2 < 110;
  const lanes = mini ? [64, 132] : LANES;
  const height = mini ? 200 : H;
  const pts = Array.from({ length: n + 1 }, (_, i) => ({ x: pad + i * step, y: lanes[i % 2] }));
  const seg = (i: number) => {
    const a = pts[i], b = pts[i + 1];
    return `M ${a.x} ${a.y} C ${a.x + step / 2} ${a.y}, ${b.x - step / 2} ${b.y}, ${b.x} ${b.y}`;
  };
  const labelW = mini ? Math.max(40, step * 2 - 6) : Math.min(184, step * 2 - 10);
  const tight = step < 80;
  return (
    <div className="relative" style={{ height }}>
      <svg width={w} height={height} className="absolute inset-0" aria-hidden>
        <RoadDefs />
        <path d={pts.slice(0, -1).map((_, i) => seg(i)).join(" ")} stroke="var(--color-panel-2)" strokeWidth="24" fill="none" strokeLinecap="round" />
        {stops.map((s, i) => <Segment key={i} d={seg(i)} s={s} />)}
      </svg>
      {stops.map((s, i) => {
        const top = i % 2 === 0;
        const { x, y } = pts[i];
        return (
          <button
            key={i}
            onClick={() => onSelect(i)}
            aria-pressed={selected === i}
            aria-label={`${s.label}: ${s.title}. ${fmtDuration(s.spent)} of ${fmtDuration(s.total)}, ${s.tasksDone} of ${s.tasks} tasks done`}
            className="group absolute flex flex-col items-center text-center"
            style={{ left: x, top: y, width: labelW, transform: `translate(-50%, ${top ? `calc(-100% + ${tight ? 18 : 22}px)` : `-${tight ? 18 : 22}px`})` }}
          >
            {!top && <Node index={i} s={s} selected={selected === i} small={tight} />}
            <span className={`${top ? "mb-2" : "mt-2"} block`}>
              {mini ? <span className={`block text-[11px] ${s.current ? "crystal-text" : "text-muted"}`}>{s.label.replace(/^(\w)\w*\s/, "$1")}</span> : <StopText s={s} tight={tight} />}
            </span>
            {top && <Node index={i} s={s} selected={selected === i} small={tight} />}
          </button>
        );
      })}
      <div
        className="absolute flex flex-col items-center text-center"
        style={{ left: pts[n].x, top: pts[n].y, width: Math.min(150, labelW), transform: n % 2 === 0 ? "translate(-50%, calc(-100% + 16px))" : "translate(-50%, -16px)" }}
      >
        {n % 2 === 1 && <Finish done={allDone} />}
        <span className={`${n % 2 === 0 ? "mb-2" : "mt-2"} text-xs text-muted`}>
          {!mini && <span className="line-clamp-2">{finish.target}</span>}
          <span className="block">by {finish.by}</span>
        </span>
        {n % 2 === 0 && <Finish done={allDone} />}
      </div>
    </div>
  );
}

function StopText({ s, tight }: { s: Stop; tight: boolean }) {
  return (
    <>
      <span className={`block text-xs ${s.current ? "crystal-text" : "text-muted"}`}>{s.label}</span>
      <span className={`line-clamp-2 block ${tight ? "text-xs" : "text-sm"} font-medium leading-tight ${s.done || s.current ? "text-ink" : "text-muted"} group-hover:text-ink`}>{s.title}</span>
      <span className={`mt-1 flex flex-wrap gap-x-2 text-xs tabular-nums text-faint justify-center ${tight ? "text-[11px]" : ""}`}>
        <span><span className={s.spent > 0 ? "text-ink/80" : ""}>{fmtDuration(s.spent)}</span> / {fmtDuration(s.total)}</span>
        <span><span className={s.tasksDone > 0 ? "text-ink/80" : ""}>{s.tasksDone}</span>/{s.tasks} tasks</span>
      </span>
    </>
  );
}

function RoadDefs() {
  return (
    <defs>
      <filter id="crystal-glow" x="-20%" y="-50%" width="140%" height="200%">
        <feGaussianBlur stdDeviation="5" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

function Segment({ d, s }: { d: string; s: Stop }) {
  if (s.done) return <path d={d} stroke="var(--color-ink)" strokeWidth="3" fill="none" strokeLinecap="round" />;
  if (s.current)
    return (
      <g filter="url(#crystal-glow)">
        <path d={d} stroke="var(--color-crystal)" strokeOpacity="0.35" strokeWidth="3" fill="none" />
        <path d={d} className="road-flow" stroke="var(--color-crystal)" strokeWidth="3" fill="none" strokeLinecap="round" />
      </g>
    );
  return <path d={d} stroke="var(--color-faint)" strokeWidth="2" strokeDasharray="1 9" fill="none" strokeLinecap="round" />;
}

function Node({ index, s, selected, small }: { index: number; s: Stop; selected: boolean; small?: boolean }) {
  return (
    <span
      className={`relative grid ${small ? "h-9 w-9 text-xs" : "h-11 w-11 text-sm"} shrink-0 place-items-center rounded-full border transition-colors ${
        s.done ? "border-ink bg-ink text-on-ink" : s.current ? "crystal-ring border-crystal bg-bg text-crystal" : "border-faint bg-bg text-muted"
      } ${selected ? "ring-2 ring-ink ring-offset-4 ring-offset-panel" : ""}`}
    >
      {s.current && <span className="glow-pulse absolute inset-0 rounded-full shadow-[0_0_28px_6px_var(--glow-soft)]" />}
      {s.done ? (
        <svg viewBox="0 0 16 16" className="h-4 w-4">
          <path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        index + 1
      )}
    </span>
  );
}

function Finish({ done }: { done: boolean }) {
  return (
    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md border ${done ? "border-ink bg-ink text-on-ink" : "border-faint text-faint"}`} aria-hidden>
      <svg viewBox="0 0 16 16" className="h-4 w-4">
        <path d="M4 14V2.5M4 3h7.5l-1.8 2.8L11.5 8.5H4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
