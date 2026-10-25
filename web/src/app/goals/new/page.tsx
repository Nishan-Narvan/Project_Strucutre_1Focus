"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { addDays, fmtDate, today, uid, WEEK_ORDER, WEEKDAYS } from "@/lib/date";
import { budget, buildSessions } from "@/lib/schedule";
import { demoRoadmapFor } from "@/lib/demo";
import { PageHeader } from "@/components/ui";
import type { Goal } from "@/lib/types";

const COLORS = ["#d97757", "#6a9bcc", "#7fb685", "#c99bd8", "#e3b341", "#5fb3b3", "#e07a9a"];
const CURRENT = ["Complete beginner", "Some exposure", "Intermediate", "Advanced"];
const TARGET = ["Working knowledge", "Job-ready / intermediate", "Advanced", "Expert"];

type StageKey = "research" | "design" | "verify" | "schedule";
const STAGES: { key: StageKey; label: string; ms: number }[] = [
  { key: "research", label: "Researching Reddit, YouTube, docs & courses", ms: 3200 },
  { key: "design", label: "Designing modules — first principles + ZPD", ms: 2600 },
  { key: "verify", label: "Cross-verifying roadmap against sources", ms: 2600 },
  { key: "schedule", label: "Breaking into daily tasks & scheduling", ms: 1200 },
];

function stageLog(key: StageKey, title: string, step: number) {
  const q = title.toLowerCase();
  const lines: Record<StageKey, string[]> = {
    research: [`🔎 site:reddit.com best way to learn ${q}`, `🔎 ${q} roadmap youtube course`, `🔎 ${q} official documentation beginner`, "📚 Summarising consensus learning order…"],
    design: ["Decomposing subject into first principles…", "Placing module 1 at the edge of your ZPD…", "Sizing tasks to your daily time budget…"],
    verify: ["Checking prerequisite order…", "🔎 Verifying resource links are live…", "Comparing against community roadmaps…"],
    schedule: ["Fitting sessions around your routines…"],
  };
  const l = lines[key];
  return l[Math.min(step, l.length - 1)];
}

export default function NewGoal() {
  const router = useRouter();
  const { state, addGoal } = useStore();
  const t = today();
  const [f, setF] = useState({
    title: "",
    outcome: "",
    currentLevel: CURRENT[1],
    known: "",
    targetLevel: TARGET[1],
    startDate: t,
    deadline: addDays(t, 56),
    hoursPerDay: 1.5,
    days: [0, 1, 2, 3, 4, 5, 6],
    prefStart: "19:00",
    prefs: "",
  });
  const [running, setRunning] = useState<{ stage: number; step: number } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const B = budget(f);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const valid = f.title.trim().length > 2 && f.days.length > 0 && f.deadline > f.startDate;

  function generate() {
    // P0: simulated pipeline. P2 replaces this with a job row in Supabase processed by the Railway worker.
    setRunning({ stage: 0, step: 0 });
    let at = 0;
    STAGES.forEach((s, si) => {
      for (let step = 0; step < 4; step++) {
        timers.current.push(setTimeout(() => setRunning({ stage: si, step }), at + (s.ms / 4) * step));
      }
      at += s.ms;
    });
    timers.current.push(
      setTimeout(() => {
        const goal: Goal = {
          ...f,
          title: f.title.trim(),
          id: uid(),
          color: COLORS[state.goals.length % COLORS.length],
          createdAt: t,
          roadmap: demoRoadmapFor(f.title.trim()),
          sessions: [],
        };
        goal.sessions = buildSessions(goal, goal.startDate < t ? t : goal.startDate);
        addGoal(goal);
        router.push(`/goals/${goal.id}`);
      }, at),
    );
  }

  function cancel() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setRunning(null);
  }

  return (
    <>
      <PageHeader title="New goal" sub="Tell Pathwise what you want to learn. The AI researches, designs, verifies and schedules it." />

      {!state.settings.apiKeyLast4 && (
        <p className="mb-5 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
          Demo mode: no API key set, so generation is simulated with a sample roadmap.{" "}
          <Link className="text-accent hover:underline" href="/settings">Add a key</Link>
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <form
          className="card space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !running) generate();
          }}
        >
          <div>
            <label className="label" htmlFor="title">What do you want to learn?</label>
            <input id="title" className="input text-base" placeholder="e.g. Data structures & algorithms for interviews" value={f.title} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="outcome">Desired outcome</label>
            <input id="outcome" className="input" placeholder="e.g. Pass coding rounds at product companies" value={f.outcome} onChange={(e) => set("outcome", e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="cur">Current level</label>
              <select id="cur" className="input" value={f.currentLevel} onChange={(e) => set("currentLevel", e.target.value)}>
                {CURRENT.map((x) => <option key={x}>{x}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="tgt">Target level</label>
              <select id="tgt" className="input" value={f.targetLevel} onChange={(e) => set("targetLevel", e.target.value)}>
                {TARGET.map((x) => <option key={x}>{x}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="known">What do you already know?</label>
            <textarea id="known" rows={2} className="input" placeholder="Helps the AI place you in your Zone of Proximal Development" value={f.known} onChange={(e) => set("known", e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="start">Start</label>
              <input id="start" type="date" className="input" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="deadline">Deadline</label>
              <input id="deadline" type="date" className="input" value={f.deadline} onChange={(e) => set("deadline", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="hpd">Hours / day</label>
              <input id="hpd" type="number" min={0.25} max={12} step={0.25} className="input" value={f.hoursPerDay} onChange={(e) => set("hoursPerDay", Number(e.target.value) || 0.25)} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div>
              <span className="label">Available days</span>
              <div className="flex flex-wrap gap-1.5">
                {WEEK_ORDER.map((d) => {
                  const on = f.days.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => set("days", on ? f.days.filter((x) => x !== d) : [...f.days, d])}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs ${on ? "border-accent bg-accent/15 text-accent" : "border-line text-muted"}`}
                    >
                      {WEEKDAYS[d]}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="label" htmlFor="pref">Preferred time</label>
              <input id="pref" type="time" className="input" value={f.prefStart} onChange={(e) => set("prefStart", e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="prefs">Learning preferences</label>
            <input id="prefs" className="input" placeholder="e.g. videos first, free resources, project-based" value={f.prefs} onChange={(e) => set("prefs", e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary w-full py-2.5 text-base" disabled={!valid || !!running}>
            Generate roadmap
          </button>
        </form>

        <aside className="space-y-4">
          <div className="card">
            <div className="label">Time budget</div>
            <div className="font-serif text-3xl">{Math.round(B.minutes / 60)} h</div>
            <p className="text-sm text-muted">
              {B.days} study days between {fmtDate(f.startDate)} and {fmtDate(f.deadline)}. The AI targets ~85% of this, leaving buffer for review.
            </p>
          </div>

          {running && (
            <div className="card">
              <div className="mb-3 flex items-center justify-between">
                <span className="label mb-0">Generating</span>
                <button className="text-xs text-muted hover:text-bad" onClick={cancel}>Cancel</button>
              </div>
              <ol className="space-y-3">
                {STAGES.map((s, i) => {
                  const status = i < running.stage ? "done" : i === running.stage ? "running" : "pending";
                  return (
                    <li key={s.key} className="flex gap-3">
                      <span
                        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] ${
                          status === "done" ? "bg-ok text-[#1a1410]" : status === "running" ? "animate-pulse bg-accent text-[#1a1410]" : "border border-line text-muted"
                        }`}
                      >
                        {status === "done" ? "✓" : i + 1}
                      </span>
                      <div className="min-w-0 text-sm">
                        <div className={status === "pending" ? "text-muted" : ""}>{s.label}</div>
                        {status === "running" && <div className="truncate text-xs text-muted">{stageLog(s.key, f.title || "this topic", running.step)}</div>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          <div className="card text-sm text-muted">
            <div className="label">How it works</div>
            <ol className="list-decimal space-y-1 pl-4">
              <li>Live research across Reddit, YouTube, docs and courses</li>
              <li>Modules built from first principles, starting at your ZPD edge</li>
              <li>An independent review pass cross-verifies order, level, time and links</li>
              <li>Modules break into daily tasks placed on your calendar around routines</li>
            </ol>
          </div>
        </aside>
      </div>
    </>
  );
}
