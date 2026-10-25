"use client";

import { progress } from "@/lib/schedule";
import { fmtDate } from "@/lib/date";
import type { Goal } from "@/lib/types";

const STEP = 210;
const PAD = 110;
const H = 300;
const Y = [105, 205]; // nodes alternate between two lanes

/** The roadmap as a winding road: one waypoint per module, then the finish. */
export function Road({ goal, selected, onSelect }: { goal: Goal; selected: number; onSelect: (i: number) => void }) {
  const p = progress(goal);
  const n = goal.roadmap.modules.length;
  const pts = Array.from({ length: n + 1 }, (_, i) => ({ x: PAD + i * STEP, y: Y[i % 2] }));
  const W = PAD * 2 + n * STEP;
  const allDone = p.modules.every((m) => m.ratio >= 1);

  const seg = (i: number) => {
    const a = pts[i], b = pts[i + 1];
    return `M ${a.x} ${a.y} C ${a.x + STEP / 2} ${a.y}, ${b.x - STEP / 2} ${b.y}, ${b.x} ${b.y}`;
  };
  const full = pts.slice(0, -1).map((_, i) => seg(i)).join(" ");

  return (
    <div className="overflow-x-auto rounded-[10px] border border-line bg-panel">
      <div className="relative" style={{ width: "100%", minWidth: W * 0.78, aspectRatio: `${W} / ${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            <filter id="crystal-glow" x="-20%" y="-50%" width="140%" height="200%">
              <feGaussianBlur stdDeviation="5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {/* the road bed */}
          <path d={full} stroke="#161616" strokeWidth="26" fill="none" strokeLinecap="round" />
          {pts.slice(0, -1).map((_, i) => {
            const done = p.modules[i].ratio >= 1;
            const current = i === p.currentModule && !done;
            if (done) return <path key={i} d={seg(i)} stroke="#f4f4f4" strokeWidth="3" fill="none" strokeLinecap="round" />;
            if (current)
              return (
                <g key={i} filter="url(#crystal-glow)">
                  <path d={seg(i)} stroke="#bfe9ff" strokeOpacity="0.35" strokeWidth="3" fill="none" />
                  <path d={seg(i)} className="road-flow" stroke="#bfe9ff" strokeWidth="3" fill="none" strokeLinecap="round" />
                </g>
              );
            return <path key={i} d={seg(i)} stroke="#4a4a4a" strokeWidth="2" strokeDasharray="1 9" fill="none" strokeLinecap="round" />;
          })}
        </svg>

        {goal.roadmap.modules.map((m, i) => {
          const mp = p.modules[i];
          const done = mp.ratio >= 1;
          const current = i === p.currentModule && !done;
          const top = i % 2 === 0;
          const { x, y } = pts[i];
          return (
            <button
              key={m.id}
              onClick={() => onSelect(i)}
              aria-pressed={selected === i}
              aria-label={`Phase ${i + 1}: ${m.title}, ${Math.round(mp.ratio * 100)}% done`}
              className="group absolute flex w-[170px] flex-col items-center text-center"
              style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%`, transform: `translate(-50%, ${top ? "calc(-100% + 22px)" : "-22px"})` }}
            >
              {!top && <Node index={i} done={done} current={current} selected={selected === i} />}
              <span className={`${top ? "mb-2" : "mt-2"} block`}>
                <span className={`block text-[11px] ${current ? "crystal-text" : "text-muted"}`}>
                  Phase {i + 1}
                  {mp.ratio > 0 && !done ? `, ${Math.round(mp.ratio * 100)}%` : done ? ", done" : ""}
                </span>
                <span className={`line-clamp-2 block text-sm leading-tight ${done || current ? "text-ink" : "text-muted"} group-hover:text-ink`}>{m.title}</span>
              </span>
              {top && <Node index={i} done={done} current={current} selected={selected === i} />}
            </button>
          );
        })}

        {/* finish */}
        <div
          className="absolute flex w-[150px] flex-col items-center text-center"
          style={{ left: `${(pts[n].x / W) * 100}%`, top: `${(pts[n].y / H) * 100}%`, transform: n % 2 === 0 ? "translate(-50%, calc(-100% + 16px))" : "translate(-50%, -16px)" }}
        >
          {n % 2 === 1 && <Finish done={allDone} />}
          <span className={`${n % 2 === 0 ? "mb-2" : "mt-2"} text-[11px] text-muted`}>
            {goal.targetLevel}
            <span className="block">by {fmtDate(goal.deadline, { day: "numeric", month: "short" })}</span>
          </span>
          {n % 2 === 0 && <Finish done={allDone} />}
        </div>
      </div>
    </div>
  );
}

function Node({ index, done, current, selected }: { index: number; done: boolean; current: boolean; selected: boolean }) {
  return (
    <span
      className={`relative grid h-11 w-11 place-items-center rounded-full border text-sm transition ${
        done ? "border-ink bg-ink text-black" : current ? "crystal-ring border-crystal bg-black text-crystal" : "border-faint bg-black text-muted"
      } ${selected ? "ring-2 ring-ink ring-offset-4 ring-offset-panel" : ""}`}
    >
      {current && <span className="glow-pulse absolute inset-0 rounded-full shadow-[0_0_28px_6px_rgba(191,233,255,0.35)]" />}
      {done ? (
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
    <span className={`grid h-8 w-8 place-items-center rounded-md border ${done ? "border-ink bg-ink text-black" : "border-faint text-faint"}`} aria-hidden>
      <svg viewBox="0 0 16 16" className="h-4 w-4">
        <path d="M4 14V2.5M4 3h7.5l-1.8 2.8L11.5 8.5H4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
