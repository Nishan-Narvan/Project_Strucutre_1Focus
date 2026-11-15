"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { fmtDate, fmtDuration, today, uid, WEEK_ORDER, WEEKDAYS } from "@/lib/date";
import { isActive, isEditable, limitsOf } from "@/lib/rules";
import { TASK_KINDS } from "@/lib/roadmap";
import { ConfirmButton } from "@/components/ui";
import type { Goal, Session, Task, TaskKind } from "@/lib/types";

/**
 * Editing controls for goals, phases, tasks, sessions and logged study. Everything here saves
 * through the store's `apply`, the same path (and the same rules) the assistants use.
 */

/** Open the assistant and ask it something, from anywhere in the app. */
export const askAssistant = (question: string) => window.dispatchEvent(new CustomEvent("wml-ask", { detail: question }));

function DayPicker({ days, onChange }: { days: number[]; onChange: (d: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Study days">
      {WEEK_ORDER.map((d) => {
        const on = days.includes(d);
        return (
          <button key={d} type="button" aria-pressed={on} onClick={() => onChange(on ? days.filter((x) => x !== d) : [...days, d].sort())} className={`rounded-full border px-2.5 py-1.5 text-xs ${on ? "border-ink text-ink" : "border-line text-faint"}`}>
            {WEEKDAYS[d].slice(0, 2)}
          </button>
        );
      })}
    </div>
  );
}

/** Edit every field of a goal, and pause, resume, archive or delete it. */
export function GoalEditor({ goal: g }: { goal: Goal }) {
  const { apply } = useStore();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const initial = () => ({ title: g.title, outcome: g.outcome, currentLevel: g.currentLevel, targetLevel: g.targetLevel, known: g.known, prefs: g.prefs, minutes: Math.round(g.hoursPerDay * 60), days: g.days, prefStart: g.prefStart, startDate: g.startDate, deadline: g.deadline });
  const [f, setF] = useState(initial);
  const [msg, setMsg] = useState("");
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const status = g.status ?? "active";

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const { minutes, ...rest } = f;
    const error = apply({ type: "update_goal", goalId: g.id, patch: { ...rest, hoursPerDay: Math.round((minutes / 60) * 100) / 100 } });
    setMsg(error ?? "Saved. If the schedule changed, the goal was re-planned from today and finished work was kept.");
  };
  const setStatus = (s: "active" | "paused" | "archived") => apply({ type: "set_goal_status", goalId: g.id, status: s, at: new Date().toISOString() });

  return (
    <section className="card mt-8" aria-label="Goal settings">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" aria-expanded={open} onClick={() => { setF(initial()); setMsg(""); setOpen((x) => !x); }}>
          {open ? "Close editor" : "Edit goal"}
        </button>
        {status === "active" ? (
          <button type="button" className="btn" onClick={() => setStatus("paused")}>Pause</button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => setStatus("active")}>Resume</button>
        )}
        {status !== "archived" && <ConfirmButton onConfirm={() => setStatus("archived")} confirmText="Click again to archive">Archive</ConfirmButton>}
        <span className="ml-auto" />
        <ConfirmButton onConfirm={() => { apply({ type: "delete_goal", goalId: g.id }); router.push("/goals"); }}>Delete goal</ConfirmButton>
      </div>

      {open && (
        <form onSubmit={save} className="mt-5 grid gap-4 border-t border-line pt-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="label" htmlFor="ge-title">Goal</label>
            <input id="ge-title" className="input" value={f.title} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor="ge-out">Why: done looks like</label>
            <input id="ge-out" className="input" value={f.outcome} onChange={(e) => set("outcome", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="ge-cur">Starting from</label>
            <input id="ge-cur" className="input" value={f.currentLevel} onChange={(e) => set("currentLevel", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="ge-tgt">Aiming for</label>
            <input id="ge-tgt" className="input" value={f.targetLevel} onChange={(e) => set("targetLevel", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="ge-known">Already know</label>
            <textarea id="ge-known" rows={2} className="input resize-none" value={f.known} onChange={(e) => set("known", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="ge-prefs">How I like to learn</label>
            <textarea id="ge-prefs" rows={2} className="input resize-none" value={f.prefs} onChange={(e) => set("prefs", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:col-span-2">
            <div>
              <label className="label" htmlFor="ge-min">Minutes a day</label>
              <input id="ge-min" type="number" min={5} max={1440} step={5} className="input" value={f.minutes} onChange={(e) => set("minutes", Number(e.target.value) || 5)} />
            </div>
            <div>
              <label className="label" htmlFor="ge-time">Start time</label>
              <input id="ge-time" type="time" className="input" value={f.prefStart} onChange={(e) => set("prefStart", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="ge-start">Start date</label>
              <input id="ge-start" type="date" className="input" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="ge-dl">Deadline</label>
              <input id="ge-dl" type="date" className="input" value={f.deadline} onChange={(e) => set("deadline", e.target.value)} />
            </div>
          </div>
          <div className="md:col-span-2">
            <span className="label">Study days</span>
            <DayPicker days={f.days} onChange={(d) => set("days", d)} />
          </div>
          <div className="flex flex-wrap items-center gap-3 md:col-span-2">
            <button className="btn btn-primary">Save changes</button>
            {msg && <span className="text-sm text-muted" role="status">{msg}</span>}
          </div>
        </form>
      )}
    </section>
  );
}

/** Shown on a paused or archived goal. */
export function StatusBanner({ goal: g }: { goal: Goal }) {
  const { apply } = useStore();
  if (isActive(g)) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-[10px] border border-line px-4 py-3 text-sm">
      <span>
        This goal is <strong>{g.status}</strong>{g.statusAt ? ` since ${fmtDate(g.statusAt.slice(0, 10))}` : ""}. It has no planned sessions and does not count toward your limits.
      </span>
      <button type="button" className="btn btn-primary ml-auto" onClick={() => apply({ type: "set_goal_status", goalId: g.id, status: "active", at: new Date().toISOString() })}>Resume</button>
    </div>
  );
}

/** Shown when a goal has no roadmap yet. */
export function NoRoadmap({ goal: g }: { goal: Goal }) {
  return (
    <div className="card mt-8">
      <p className="text-ink">This goal has no roadmap yet, so nothing is scheduled.</p>
      <p className="mt-1 text-sm text-muted">The assistant can write one from your goal&apos;s details, or ask Claude through the connector. You can also add phases yourself.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={() => askAssistant(`Write a roadmap for my goal "${g.title}" (goal_id ${g.id}) with set_roadmap. Start from what I already know, fit it to my daily time and deadline, and explain the approach briefly.`)}>
          Ask the assistant to write it
        </button>
        <AddPhase goal={g} />
      </div>
    </div>
  );
}

/** Add a phase at the end of the roadmap. */
export function AddPhase({ goal: g, label = "Add a phase" }: { goal: Goal; label?: string }) {
  const { apply } = useStore();
  const [title, setTitle] = useState("");
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="btn" onClick={() => setOpen(true)}>{label}</button>;
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        const phase = { id: `p${uid()}`, title: title.trim(), level: "", objective: "", first_principle: "", zpd_scaffold: "", estimated_hours: 0, key_concepts: [], checkpoint: "", resources: [], tasks: [] };
        if (!apply({ type: "add_phase", goalId: g.id, phase })) {
          setTitle("");
          setOpen(false);
        }
      }}
    >
      <input className="input w-64" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Phase name" aria-label="Phase name" />
      <button className="btn btn-primary">Add</button>
      <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}

/** Edit a phase's text, move it, or delete it. */
export function PhaseEditor({ goal: g, index }: { goal: Goal; index: number }) {
  const { state, apply } = useStore();
  const router = useRouter();
  const m = g.roadmap.modules[index];
  const [open, setOpen] = useState(false);
  const fields = () => ({ title: m.title, objective: m.objective, checkpoint: m.checkpoint, level: m.level, notes: m.notes ?? "", zpd_scaffold: m.zpd_scaffold, first_principle: m.first_principle, concepts: m.key_concepts.join(", ") });
  const [f, setF] = useState(fields);
  const editable = isEditable(g, limitsOf(state).editWindowDays);
  const elaborate = () =>
    askAssistant(
      `Elaborate phase ${index + 1} "${m.title}" of my goal "${g.title}" (goal_id ${g.id}). Read the roadmap and its materials first. Then improve the phase with update_phase (a clear objective, a concrete checkpoint, details on what it covers and how to approach it) and add or split tasks where it is too thin. Keep my finished work. Tell me briefly what you changed.`,
    );
  const move = (d: number) => {
    const ids = g.roadmap.modules.map((x) => x.id);
    const j = index + d;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    if (!apply({ type: "reorder_phases", goalId: g.id, order: ids })) router.replace(`/goals/${g.id}/phase/${j + 1}`);
  };
  return (
    <div className="mt-6">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" onClick={() => { setF(fields()); setOpen((x) => !x); }}>{open ? "Close" : "Edit phase"}</button>
        <button type="button" className="btn" onClick={elaborate}>Ask the assistant to elaborate</button>
        <button type="button" className="btn" disabled={index === 0} onClick={() => move(-1)}>Move earlier</button>
        <button type="button" className="btn" disabled={index === g.roadmap.modules.length - 1} onClick={() => move(1)}>Move later</button>
        {editable && <ConfirmButton onConfirm={() => { if (!apply({ type: "delete_phase", goalId: g.id, phaseId: m.id })) router.push(`/goals/${g.id}`); }}>Delete phase</ConfirmButton>}
      </div>
      {open && (
        <form
          className="mt-4 grid max-w-xl gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const { concepts, ...rest } = f;
            const key_concepts = concepts.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 12);
            if (!apply({ type: "update_phase", goalId: g.id, phaseId: m.id, patch: { ...rest, key_concepts } })) setOpen(false);
          }}
        >
          <label className="label" htmlFor="pe-title">Title</label>
          <input id="pe-title" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <label className="label" htmlFor="pe-obj">Objective: what you can do at the end</label>
          <textarea id="pe-obj" className="input resize-none" rows={2} value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} />
          <label className="label" htmlFor="pe-notes">Details: what this phase covers, in your own words</label>
          <textarea id="pe-notes" className="input" rows={5} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Sub-topics, order, what to focus on, links to think about…" />
          <label className="label" htmlFor="pe-app">Approach: how to tackle it</label>
          <textarea id="pe-app" className="input resize-none" rows={2} value={f.zpd_scaffold} onChange={(e) => setF({ ...f, zpd_scaffold: e.target.value })} />
          <label className="label" htmlFor="pe-cp">Checkpoint: a test that shows it is mastered</label>
          <textarea id="pe-cp" className="input resize-none" rows={2} value={f.checkpoint} onChange={(e) => setF({ ...f, checkpoint: e.target.value })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="pe-fp">Built on</label>
              <input id="pe-fp" className="input" value={f.first_principle} onChange={(e) => setF({ ...f, first_principle: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="pe-lvl">Level</label>
              <input id="pe-lvl" className="input" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} />
            </div>
          </div>
          <label className="label" htmlFor="pe-kc">Key concepts, comma separated</label>
          <input id="pe-kc" className="input" value={f.concepts} onChange={(e) => setF({ ...f, concepts: e.target.value })} />
          <div><button className="btn btn-primary">Save phase</button></div>
        </form>
      )}
    </div>
  );
}

/** Per-task controls: edit, move up or down, move to another phase, delete. */
export function TaskControls({ goal: g, task, phaseIndex, position, done }: { goal: Goal; task: Task; phaseIndex: number; position: number; done: boolean }) {
  const { state, apply } = useStore();
  const [edit, setEdit] = useState(false);
  const [inserting, setInserting] = useState(false);
  const [f, setF] = useState({ title: task.title, minutes: task.minutes, kind: task.kind, detail: task.detail });
  const m = g.roadmap.modules[phaseIndex];
  const editable = isEditable(g, limitsOf(state).editWindowDays);
  const shift = (d: number) => {
    const ids = m.tasks.map((x) => x.id);
    const j = position + d;
    [ids[position], ids[j]] = [ids[j], ids[position]];
    apply({ type: "reorder_tasks", goalId: g.id, phaseId: m.id, order: ids });
  };
  if (edit)
    return (
      <form
        className="mt-2 grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!apply({ type: "update_task", goalId: g.id, taskId: task.id, patch: f })) setEdit(false);
        }}
      >
        <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label="Task title" />
        <div className="flex flex-wrap gap-2">
          <select className="input w-auto" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as TaskKind })} aria-label="Kind">
            {TASK_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input type="number" min={5} max={600} step={5} className="input w-24" value={f.minutes} onChange={(e) => setF({ ...f, minutes: Number(e.target.value) || 5 })} aria-label="Minutes" />
        </div>
        <textarea className="input resize-none" rows={2} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} aria-label="Detail" placeholder="What exactly to do" />
        <div className="flex gap-2"><button className="btn btn-primary">Save</button><button type="button" className="btn" onClick={() => setEdit(false)}>Cancel</button></div>
      </form>
    );
  if (inserting) return <InsertTask goal={g} phaseIndex={phaseIndex} at={position + 1} onDone={() => setInserting(false)} />;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
      <button type="button" className="hover:text-ink" onClick={() => { setF({ title: task.title, minutes: task.minutes, kind: task.kind, detail: task.detail }); setEdit(true); }}>Edit</button>
      <button type="button" className="hover:text-ink" onClick={() => setInserting(true)}>Insert task below</button>
      <button type="button" className="hover:text-ink disabled:opacity-30" disabled={position === 0} onClick={() => shift(-1)} aria-label={`Move ${task.title} up`}>Up</button>
      <button type="button" className="hover:text-ink disabled:opacity-30" disabled={position === m.tasks.length - 1} onClick={() => shift(1)} aria-label={`Move ${task.title} down`}>Down</button>
      {g.roadmap.modules.length > 1 && (
        <select
          className="rounded border border-line bg-bg px-1 py-0.5 text-xs text-muted"
          value=""
          onChange={(e) => e.target.value && apply({ type: "move_task", goalId: g.id, taskId: task.id, toPhaseId: e.target.value })}
          aria-label={`Move ${task.title} to another phase`}
        >
          <option value="">Move to phase…</option>
          {g.roadmap.modules.map((x, i) => (i === phaseIndex ? null : <option key={x.id} value={x.id}>{i + 1}. {x.title}</option>))}
        </select>
      )}
      {editable && !done && <button type="button" className="hover:text-bad" onClick={() => apply({ type: "remove_task", goalId: g.id, taskId: task.id })} aria-label={`Remove ${task.title}`}>Remove</button>}
    </div>
  );
}

/** Skip, move or re-note one session. */
export function SessionControls({ goal: g, session: s }: { goal: Goal; session: Session }) {
  const { apply } = useStore();
  const [mode, setMode] = useState<"" | "skip" | "move" | "note">("");
  const [text, setText] = useState("");
  const [date, setDate] = useState(s.date);
  const [time, setTime] = useState(s.start ?? "");
  if (mode === "skip")
    return (
      <form className="mt-1.5 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (!apply({ type: "skip_session", goalId: g.id, sessionId: s.id, reason: text, at: new Date().toISOString() })) setMode(""); }}>
        <input className="input w-56" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Why? (sick, travelling…)" aria-label="Reason for skipping" />
        <button className="btn">Skip it</button>
        <button type="button" className="btn" onClick={() => setMode("")}>Cancel</button>
      </form>
    );
  if (mode === "move")
    return (
      <form className="mt-1.5 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (!apply({ type: "move_session", goalId: g.id, sessionId: s.id, date, start: time || undefined })) setMode(""); }}>
        <input type="date" className="input w-auto" value={date} min={today()} onChange={(e) => setDate(e.target.value)} aria-label="New date" />
        <input type="time" className="input w-auto" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Start time (optional)" />
        <button className="btn">Move</button>
        <button type="button" className="btn" onClick={() => setMode("")}>Cancel</button>
      </form>
    );
  if (mode === "note")
    return (
      <form className="mt-1.5 grid gap-2" onSubmit={(e) => { e.preventDefault(); if (!apply({ type: "set_session_note", goalId: g.id, sessionId: s.id, note: text })) setMode(""); }}>
        <textarea className="input resize-none" rows={2} autoFocus value={text} onChange={(e) => setText(e.target.value)} aria-label="Note" />
        <div className="flex gap-2"><button className="btn">Save note</button><button type="button" className="btn" onClick={() => setMode("")}>Cancel</button></div>
      </form>
    );
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-faint">
      {s.skipped ? (
        <button type="button" className="hover:text-ink" onClick={() => apply({ type: "unskip_session", goalId: g.id, sessionId: s.id })}>Skipped ({s.skipped.reason}). Undo skip</button>
      ) : !s.done ? (
        <>
          <button type="button" className="hover:text-ink" onClick={() => { setText(""); setMode("skip"); }}>Skip</button>
          <button type="button" className="hover:text-ink" onClick={() => setMode("move")}>Move</button>
        </>
      ) : (
        <button type="button" className="hover:text-ink" onClick={() => { setText(s.note ?? ""); setMode("note"); }}>{s.note ? "Edit note" : "Add note"}</button>
      )}
    </div>
  );
}

/** Log study done outside the plan, and see or remove what was logged. */
export function StudyLog({ goal: g }: { goal: Goal }) {
  const { apply } = useStore();
  const [f, setF] = useState({ minutes: 30, date: today(), note: "" });
  const logs = [...(g.logs ?? [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  return (
    <section className="card mt-8" aria-labelledby={`log-${g.id}`}>
      <h2 id={`log-${g.id}`} className="text-base font-medium">Extra study</h2>
      <p className="mt-1 text-sm text-muted">Time you put in outside the plan. It counts toward your time KPIs, not toward roadmap progress.</p>
      <form
        className="mt-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!apply({ type: "log_study", goalId: g.id, log: { id: uid() + uid(), date: f.date, minutes: f.minutes, note: f.note, at: new Date().toISOString() } })) setF({ ...f, note: "" });
        }}
      >
        <input type="number" min={1} max={960} className="input w-24" value={f.minutes} onChange={(e) => setF({ ...f, minutes: Number(e.target.value) || 1 })} aria-label="Minutes" />
        <input type="date" className="input w-auto" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="Date" />
        <input className="input min-w-48 flex-1" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="What you did (optional)" aria-label="Note" />
        <button className="btn">Log time</button>
      </form>
      {logs.length > 0 && (
        <ul className="mt-4 divide-y divide-line border-y border-line text-sm">
          {logs.map((l) => (
            <li key={l.id} className="flex items-center gap-3 py-2">
              <span className="w-24 shrink-0 text-muted">{fmtDate(l.date)}</span>
              <span className="w-16 shrink-0">{fmtDuration(l.minutes)}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{l.note}</span>
              <button type="button" className="text-xs text-faint hover:text-bad" onClick={() => apply({ type: "delete_study_log", goalId: g.id, logId: l.id })}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One one-off event, with inline editing. */
export function EventItem({ event: e }: { event: import("@/lib/types").DayEvent }) {
  const { apply } = useStore();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState(e);
  if (edit)
    return (
      <li>
        <form className="grid gap-2" onSubmit={(ev) => { ev.preventDefault(); if (!apply({ type: "update_event", event: f })) setEdit(false); }}>
          <input className="input" value={f.title} onChange={(x) => setF({ ...f, title: x.target.value })} aria-label="Event title" />
          <div className="flex flex-wrap gap-2">
            <input type="date" className="input w-auto" value={f.date} onChange={(x) => setF({ ...f, date: x.target.value })} aria-label="Date" />
            <input type="time" className="input w-auto" value={f.start} onChange={(x) => setF({ ...f, start: x.target.value })} aria-label="Start" />
            <input type="time" className="input w-auto" value={f.end} onChange={(x) => setF({ ...f, end: x.target.value })} aria-label="End" />
          </div>
          <div className="flex gap-2"><button className="btn">Save</button><button type="button" className="btn" onClick={() => setEdit(false)}>Cancel</button></div>
        </form>
      </li>
    );
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className="text-muted">{e.start}–{e.end}</span> {e.title}
      <button className="ml-auto text-xs text-muted hover:text-ink" onClick={() => { setF(e); setEdit(true); }} aria-label={`Edit ${e.title}`}>Edit</button>
      <button className="text-xs text-muted hover:text-bad" onClick={() => apply({ type: "delete_event", id: e.id })} aria-label={`Remove ${e.title}`}>Remove</button>
    </li>
  );
}

/** Insert a task at a position inside a phase. */
export function InsertTask({ goal: g, phaseIndex, at, onDone }: { goal: Goal; phaseIndex: number; at: number; onDone: () => void }) {
  const { state, apply } = useStore();
  const [f, setF] = useState({ title: "", minutes: state.settings.defaultTaskMinutes ?? 45, kind: "practice" as TaskKind });
  return (
    <form
      className="mt-2 flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!f.title.trim()) return;
        const m = g.roadmap.modules[phaseIndex];
        if (!apply({ type: "add_task", goalId: g.id, moduleIndex: phaseIndex, index: at, task: { id: `${m.id}x${uid()}`, title: f.title.trim(), minutes: f.minutes, kind: f.kind, detail: "" } })) onDone();
      }}
    >
      <input className="input min-w-48 flex-1" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="New task, inserted here" aria-label="New task" />
      <select className="input w-auto" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as TaskKind })} aria-label="Kind">
        {TASK_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
      <input type="number" min={5} max={600} step={5} className="input w-24" value={f.minutes} onChange={(e) => setF({ ...f, minutes: Number(e.target.value) || 5 })} aria-label="Minutes" />
      <button className="btn btn-primary">Insert</button>
      <button type="button" className="btn" onClick={onDone}>Cancel</button>
    </form>
  );
}

/** The phases as a list, with a place to insert a new phase between any two. */
export function PhaseList({ goal: g }: { goal: Goal }) {
  const { apply } = useStore();
  const [at, setAt] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const insert = (index: number) => {
    if (!title.trim()) return;
    const phase = { id: `p${uid()}`, title: title.trim(), level: "", objective: "", first_principle: "", zpd_scaffold: "", estimated_hours: 0, key_concepts: [], checkpoint: "", resources: [], tasks: [] };
    if (!apply({ type: "add_phase", goalId: g.id, phase, index })) {
      setAt(null);
      setTitle("");
    }
  };
  const slot = (index: number) =>
    at === index ? (
      <li key={`slot-${index}`} className="py-2">
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); insert(index); }}>
          <input className="input min-w-48 flex-1" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`New phase ${index + 1}`} aria-label="New phase name" />
          <button className="btn btn-primary">Insert phase</button>
          <button type="button" className="btn" onClick={() => setAt(null)}>Cancel</button>
        </form>
      </li>
    ) : (
      <li key={`slot-${index}`} className="flex justify-center">
        <button type="button" className="rounded-full px-3 py-0.5 text-xs text-faint transition hover:bg-panel-2 hover:text-ink" onClick={() => { setTitle(""); setAt(index); }}>
          + Insert a phase here
        </button>
      </li>
    );
  return (
    <section className="card mt-6" aria-label="Phases">
      <h2 className="mb-2 text-base font-medium">Phases</h2>
      <ul>
        {slot(0)}
        {g.roadmap.modules.flatMap((m, i) => [
          <li key={m.id} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-panel-2">
            <span className="w-6 shrink-0 text-muted">{i + 1}.</span>
            <Link href={`/goals/${g.id}/phase/${i + 1}`} className="min-w-0 flex-1 truncate hover:underline">{m.title}</Link>
            <span className="shrink-0 text-xs text-muted">{m.tasks.length} task{m.tasks.length === 1 ? "" : "s"}{(g.materials ?? []).some((x) => x.phaseId === m.id) ? " · materials" : ""}</span>
          </li>,
          slot(i + 1),
        ])}
      </ul>
    </section>
  );
}

/** Download or copy the memory file: everything about a goal (or all goals) for another model. */
export function MemoryFileButtons({ goalId, label = "Memory file" }: { goalId?: string; label?: string }) {
  const { state } = useStore();
  const [msg, setMsg] = useState("");
  const make = async () => {
    const { buildMemoryFile, approxTokens } = await import("@/lib/memoryFile");
    const text = buildMemoryFile(state, today(), { goalId, generatedAt: new Date().toISOString().slice(0, 16) });
    return { text, tokens: approxTokens(text) };
  };
  const name = goalId ? state.goals.find((g) => g.id === goalId)?.title ?? "goal" : "all-goals";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted">{label}:</span>
      <button
        type="button"
        className="btn"
        onClick={async () => {
          const { text, tokens } = await make();
          const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
          const a = Object.assign(document.createElement("a"), { href: url, download: `where-mylife-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${today()}.md` });
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          setMsg(`Downloaded, about ${tokens.toLocaleString()} tokens.`);
        }}
      >
        Download
      </button>
      <button
        type="button"
        className="btn"
        onClick={async () => {
          const { text, tokens } = await make();
          await navigator.clipboard.writeText(text).catch(() => {});
          setMsg(`Copied, about ${tokens.toLocaleString()} tokens. Paste it into any model to carry on.`);
        }}
      >
        Copy
      </button>
      {msg && <span className="text-xs text-muted" role="status">{msg}</span>}
    </div>
  );
}
