"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { addDays, today, uid, WEEK_ORDER, WEEKDAYS } from "@/lib/date";
import { budget } from "@/lib/schedule";
import { committedHours, isActive, limitsOf } from "@/lib/rules";
import { agentReady } from "@/lib/providers";
import { emptyRoadmap } from "@/lib/roadmap";
import { askAssistant } from "@/components/Editors";
import { OnTop } from "@/components/ui";
import type { Goal } from "@/lib/types";

const TINTS = ["#f5f5f5", "#b8b8b8", "#8a8a8a", "#d4d4d4"];

/**
 * Start a new goal: fill in the brief, create it, and the assistant writes the roadmap from it.
 * Or skip the form and talk it through with the assistant, which creates the goal itself.
 * Nothing here is scripted: every roadmap comes from a real model (the in-app assistant or Claude).
 */
export function NewGoalDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { state, addGoal } = useStore();
  const t = today();
  const L = limitsOf(state);
  const ready = agentReady(state.settings);
  const [f, setF] = useState({
    title: "",
    outcome: "",
    currentLevel: "Some exposure",
    known: "",
    targetLevel: "Working knowledge",
    prefs: "",
    startDate: t,
    deadline: addDays(t, 56),
    minutes: 60,
    days: [1, 2, 3, 4, 5],
    prefStart: "19:00",
  });
  const first = useRef<HTMLInputElement>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    first.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const hoursPerDay = Math.round((f.minutes / 60) * 100) / 100;
  const B = budget({ ...f, hoursPerDay });
  const active = state.goals.filter(isActive).length;
  const atLimit = active >= L.maxActiveGoals;
  const hoursAfter = Math.round((committedHours(state.goals) + hoursPerDay) * 100) / 100;
  const overHours = hoursAfter > L.maxDailyHours;
  // What still stops the goal from being created, in words, shown next to the button
  const problems = [
    ...(f.title.trim().length < 2 ? ["Write what you want to learn (at the top)."] : []),
    ...(f.days.length === 0 ? ["Pick at least one study day."] : []),
    ...(f.deadline <= f.startDate ? ["The deadline must be after the start date."] : []),
    ...(overHours ? [`That is ${hoursAfter} h a day across active goals, over your ${L.maxDailyHours} h limit: lower the minutes or pause a goal.`] : []),
  ];
  const valid = problems.length === 0 && !atLimit;
  const [tried, setTried] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  function create() {
    const title = f.title.trim();
    const goal: Goal = {
      id: uid() + uid(),
      title,
      outcome: f.outcome.trim(),
      currentLevel: f.currentLevel.trim(),
      targetLevel: f.targetLevel.trim(),
      known: f.known.trim(),
      prefs: f.prefs.trim(),
      startDate: f.startDate,
      deadline: f.deadline,
      hoursPerDay,
      days: f.days,
      prefStart: f.prefStart,
      color: TINTS[state.goals.length % TINTS.length],
      createdAt: t,
      roadmap: emptyRoadmap(title),
      sessions: [],
      status: "active",
    };
    if (!addGoal(goal)) return;
    onClose();
    router.push(`/goals/${goal.id}`);
    if (ready)
      askAssistant(
        `I just created the goal "${title}" (goal_id ${goal.id}). Write its roadmap with set_roadmap: start from what I already know, fit the total time to my daily minutes and deadline, use concrete tasks and checkpoints, and real resources only. Then tell me in a few lines why it is ordered this way.`,
      );
  }

  function talk() {
    onClose();
    askAssistant("I want to start a new learning goal. Ask me what I need to tell you, check whether I have room for it, then create it with create_goal including a full roadmap.");
  }

  return (
    <OnTop>
    <div className="fixed inset-0 z-50 grid place-items-center bg-scrim p-3 md:p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="new-goal-title" className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[16px] md:max-h-[calc(100dvh-3rem)] border border-line bg-bg shadow-2xl shadow-black/30" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 md:px-7 md:py-5">
          <div>
            <h2 id="new-goal-title" className="font-serif text-3xl leading-none tracking-tight">{atLimit ? `You already have ${L.maxActiveGoals} active goals` : "Start a new goal"}</h2>
            <p className="mt-2 max-w-xl text-sm text-muted">
              {atLimit
                ? "Finish, pause or archive one to start another, or raise the limit in Settings."
                : ready
                  ? "Fill in the brief and the assistant writes the roadmap from it. Or talk it through instead."
                  : "Fill in the brief. Connect a model in Settings and the assistant can write the roadmap; Claude can too, through the connector."}
            </p>
          </div>
          <button type="button" className="btn shrink-0" onClick={onClose}>Close</button>
        </header>

        {atLimit && (
          <div className="flex flex-wrap gap-2 p-5 md:p-7">
            <button type="button" className="btn btn-primary" onClick={onClose}>Pause or archive a goal</button>
            <Link href="/settings" className="btn" onClick={onClose}>Raise the limit in Settings</Link>
          </div>
        )}
        {!atLimit && (
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={(e) => { e.preventDefault(); setTried(true); if (valid) create(); }}>
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 md:grid-cols-2 md:p-7">
            <div className="md:col-span-2">
              <label className="label" htmlFor="ng-title">What do you want to learn?</label>
              <input id="ng-title" ref={first} className="input" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Get interview-ready in data structures and algorithms" />
            </div>
            <div className="md:col-span-2">
              <label className="label" htmlFor="ng-out">Why, and what does done look like?</label>
              <input id="ng-out" className="input" value={f.outcome} onChange={(e) => set("outcome", e.target.value)} placeholder="Pass coding rounds at product companies" />
            </div>
            <div className="grid grid-cols-2 gap-3 md:col-span-2">
              <div>
                <label className="label" htmlFor="ng-min">Minutes a day</label>
                <input id="ng-min" type="number" min={5} max={1440} step={5} className="input" value={f.minutes} onChange={(e) => set("minutes", Number(e.target.value) || 5)} />
              </div>
              <div>
                <label className="label" htmlFor="ng-dl">Deadline</label>
                <input id="ng-dl" type="date" className="input" value={f.deadline} onChange={(e) => set("deadline", e.target.value)} />
              </div>
            </div>
            <div className="md:col-span-2">
              <span className="label">Study days</span>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Study days">
                {WEEK_ORDER.map((d) => {
                  const on = f.days.includes(d);
                  return (
                    <button key={d} type="button" aria-pressed={on} onClick={() => set("days", on ? f.days.filter((x) => x !== d) : [...f.days, d].sort())} className={`rounded-full border px-2.5 py-1.5 text-xs ${on ? "border-ink text-ink" : "border-line text-faint"}`}>
                      {WEEKDAYS[d].slice(0, 2)}
                    </button>
                  );
                })}
              </div>
            </div>

            <details className="group md:col-span-2" open={moreOpen} onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}>
              <summary className="cursor-pointer list-none text-sm text-muted select-none hover:text-ink">
                <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>›</span> More details <span className="text-faint">(levels, what you know, start date and time)</span>
              </summary>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="label" htmlFor="ng-cur">Starting from</label>
                  <input id="ng-cur" className="input" value={f.currentLevel} onChange={(e) => set("currentLevel", e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="ng-tgt">Aiming for</label>
                  <input id="ng-tgt" className="input" value={f.targetLevel} onChange={(e) => set("targetLevel", e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="ng-known">Already know</label>
                  <textarea id="ng-known" rows={2} className="input resize-none" value={f.known} onChange={(e) => set("known", e.target.value)} placeholder="Python basics, ~20 easy problems" />
                </div>
                <div>
                  <label className="label" htmlFor="ng-prefs">How you like to learn</label>
                  <textarea id="ng-prefs" rows={2} className="input resize-none" value={f.prefs} onChange={(e) => set("prefs", e.target.value)} placeholder="Short videos, then lots of practice" />
                </div>
                <div className="grid grid-cols-2 gap-3 md:col-span-2">
                  <div>
                    <label className="label" htmlFor="ng-time">Start time</label>
                    <input id="ng-time" type="time" className="input" value={f.prefStart} onChange={(e) => set("prefStart", e.target.value)} />
                  </div>
                  <div>
                    <label className="label" htmlFor="ng-start">Start date</label>
                    <input id="ng-start" type="date" className="input" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} />
                  </div>
                </div>
              </div>
            </details>

            <div className="rounded-lg bg-panel-2 px-4 py-3 md:col-span-2">
              <div className="font-serif text-3xl">{Math.round(B.minutes / 60)} hours</div>
              <p className="text-sm text-muted">over {B.days} study days, before the deadline.</p>
              {overHours && <p className="mt-2 text-sm text-bad">That would take you to {hoursAfter} h a day across active goals, over your {L.maxDailyHours} h limit. Lower the minutes, or pause another goal.</p>}
              {f.deadline <= f.startDate && <p className="mt-2 text-sm text-bad">The deadline must be after the start date.</p>}
            </div>

            <p className="text-xs text-faint md:col-span-2">
              {active} of {L.maxActiveGoals} active goals in use.{L.editWindowDays ? ` Phases and tasks can be removed for ${L.editWindowDays} days, then only added to.` : ""}
            </p>
          </div>
          {/* Always visible, whatever the screen height: the form above scrolls, this does not */}
          <div className="shrink-0 border-t border-line px-5 py-4 md:px-7">
            {tried && problems.length > 0 && (
              <ul className="mb-3 space-y-0.5 text-sm text-bad" role="alert">
                {problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn btn-primary">+ {ready ? "Create goal and write its roadmap" : "Create goal"}</button>
              {ready && <button type="button" className="btn" onClick={talk}>Talk it through with the assistant instead</button>}
            </div>
          </div>
          </form>
        )}
      </div>
    </div>
    </OnTop>
  );
}
