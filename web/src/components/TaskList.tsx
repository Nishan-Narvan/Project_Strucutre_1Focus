"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { clock, fmtDate, fmtDuration, hhmm, today, uid } from "@/lib/date";
import { layoutDay, taskSessions } from "@/lib/schedule";
import { limitsOf } from "@/lib/rules";
import { detailPoints, shortPhaseTitle, splitPhaseTitle } from "@/lib/phaseTitle";
import { KindSelect, KindTag, useKindColor } from "@/components/Kinds";
import { useTaskActions } from "@/components/Editors";
import { Arrow } from "@/components/PhaseList";
import { WeekDates } from "@/components/WeekDates";
import { Popover } from "@/components/Popover";
import { TaskMaterials } from "@/components/Materials";
import { checkMaterialUrl, detectKind, titleFromUrl } from "@/lib/materials";
import { CompleteButton, fmtDoneAt, Menu } from "@/components/ui";
import type { Goal, Session, Task, TaskKind } from "@/lib/types";

type Slot = { start: number; end: number; conflict?: boolean };

/** One phase's tasks as a Trello-style list: a header for the week, then a card per task. */
export function TaskList({ goal: g, index, current }: { goal: Goal; index: number; current: boolean }) {
  const { state } = useStore();
  const m = g.roadmap.modules[index];
  const [adding, setAdding] = useState(false);
  const [hideDone, setHideDone] = useState(false);

  // Where each of this phase's sessions sits in its day (same placement as the day view)
  const mine = g.sessions.filter((s) => s.moduleIndex === index);
  const slots: Record<string, Slot> = {};
  for (const date of new Set(mine.map((s) => s.date))) {
    for (const b of layoutDay(state, date).study) {
      if (b.goal.id !== g.id) continue;
      const had = slots[b.session.id];
      slots[b.session.id] = had ? { start: Math.min(had.start, b.start), end: Math.max(had.end, b.end), conflict: had.conflict || b.conflict } : { start: b.start, end: b.end, conflict: b.conflict };
    }
  }
  const isDone = (t: Task) => {
    const s = taskSessions(g, t.id);
    return s.length > 0 && s.every((x) => x.done);
  };
  const next = m.tasks.find((t) => !isDone(t));
  const doneCount = m.tasks.filter(isDone).length;
  const { label } = splitPhaseTitle(m.title);
  const shown = m.tasks.map((t, position) => ({ t, position })).filter(({ t }) => !(hideDone && isDone(t)));

  return (
    <section
      aria-label="Tasks"
      className="rounded-[20px] p-3 sm:p-4"
      style={{ background: `color-mix(in srgb, var(${doneCount === m.tasks.length && m.tasks.length ? "--done" : current ? "--crystal" : "--muted"}) 5%, var(--s1))` }}
    >
      <header className="flex items-start gap-3 px-1 pb-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-6">
            {label ?? `Week ${index + 1}`}: {shortPhaseTitle(m.title)}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <WeekDates goal={g} index={index} className="-ml-1.5" />
            <span className="tabular-nums">{fmtDuration(m.tasks.reduce((a, x) => a + x.minutes, 0))} in total</span>
            {m.tasks.length > 0 && doneCount === m.tasks.length && <span className="font-medium text-done">Week complete</span>}
          </div>
        </div>
        <span
          className={`mt-0.5 rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums ${doneCount === m.tasks.length && m.tasks.length > 0 ? "bg-done/15 text-done" : "bg-panel-2 text-ink"}`}
          title={`${doneCount} of ${m.tasks.length} done`}
        >
          {doneCount}/{m.tasks.length}
        </span>
        <Menu
          label="List actions"
          items={[
            { label: "Add a task", onSelect: () => setAdding(true) },
            { label: hideDone ? "Show done tasks" : "Hide done tasks", onSelect: () => setHideDone((x) => !x), disabled: doneCount === 0 },
          ]}
        />
      </header>

      <ol className="space-y-4">
        {shown.map(({ t, position }) => (
          <TaskCard key={t.id} goal={g} task={t} index={index} position={position} count={m.tasks.length} done={isDone(t)} isNext={current && t.id === next?.id} slots={slots} />
        ))}
      </ol>
      {m.tasks.length === 0 && <p className="px-1 py-4 text-sm text-muted">No tasks in this week yet.</p>}

      {adding ? <AddTask goal={g} index={index} onDone={() => setAdding(false)} /> : (
        <button type="button" className="mt-3 flex w-full items-center gap-2 rounded-[14px] px-4 py-3 text-left text-sm text-muted transition-colors hover:bg-panel hover:text-ink" onClick={() => setAdding(true)}>
          <span className="grid h-5 w-5 place-items-center rounded-full border-2 border-dashed border-muted text-xs leading-none" aria-hidden>+</span>
          Add a task
        </button>
      )}
    </section>
  );
}

function TaskCard({ goal: g, task, index, position, count, done, isNext, slots }: { goal: Goal; task: Task; index: number; position: number; count: number; done: boolean; isNext: boolean; slots: Record<string, Slot> }) {
  const { completeTask, reopenTask, apply } = useStore();
  const m = g.roadmap.modules[index];
  const [linking, setLinking] = useState(false);
  const kindColor = useKindColor(task.kind);
  const shift = (d: number) => {
    const ids = m.tasks.map((x) => x.id);
    [ids[position], ids[position + d]] = [ids[position + d], ids[position]];
    apply({ type: "reorder_tasks", goalId: g.id, phaseId: m.id, order: ids });
  };
  const { menu, panel } = useTaskActions({ goal: g, task, phaseIndex: index, position, done });
  const sessions = taskSessions(g, task.id);
  const doneAt = sessions.filter((s) => s.doneAt).map((s) => s.doneAt!).sort().pop();
  const points = detailPoints(task.detail);
  const notes = sessions.filter((s) => s.done && s.note);
  const stripe = done ? "var(--done)" : kindColor;
  return (
    <li
      id={`task-${task.id}`}
      className={`group/card relative scroll-mt-24 rounded-[14px] border-[1.5px] py-4 pl-5 pr-3 transition-colors sm:pr-4 ${isNext ? "crystal-ring" : ""}`}
      style={{
        background: `color-mix(in srgb, ${stripe} ${done ? 10 : 8}%, var(--s2))`,
        borderColor: isNext ? "var(--crystal)" : `color-mix(in srgb, ${stripe} 45%, transparent)`,
      }}
    >
      {/* the task's colour: its category, or green once done. Rounded itself: overflow-hidden on the card would clip its ⋯ menu */}
      <span className="absolute inset-y-0 left-0 w-1.5 rounded-l-[12.5px]" style={{ background: stripe }} aria-hidden />

      <div className="flex items-center gap-3">
        <When goal={g} sessions={sessions} slots={slots} done={done} />
        <span className="ml-auto hidden items-center gap-3 text-xs text-muted sm:flex">
          <KindTag kind={task.kind} />
          <span className="tabular-nums">{fmtDuration(task.minutes)}</span>
        </span>
        <span className="ml-auto flex items-center sm:ml-0">
          <Arrow dir="up" disabled={position === 0} label={`Move ${task.title} up`} onClick={() => shift(-1)} />
          <Arrow dir="down" disabled={position === count - 1} label={`Move ${task.title} down`} onClick={() => shift(1)} />
          <span className="-mr-1">{menu}</span>
        </span>
      </div>

      <div className="mt-2 flex items-start gap-3">
        <CompleteButton done={done} current={isNext} title={task.title} size="mt-0.5 h-5 w-5" onComplete={(note) => completeTask(g.id, task.id, note)} onReopen={() => reopenTask(g.id, task.id)} />
        <span className={`min-w-0 flex-1 text-base font-medium leading-6 ${done ? "text-ink/70 line-through decoration-done/70" : isNext ? "crystal-text" : "text-ink"}`}>{task.title}</span>
        <span className="text-xs tabular-nums text-muted sm:hidden">{fmtDuration(task.minutes)}</span>
      </div>

      {points.length > 0 && (
        <ul className={`ml-8 mt-2 list-disc space-y-1 pl-4 text-sm leading-5 marker:text-muted ${done ? "text-muted" : "text-ink/80"}`}>
          {points.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      )}

      {(done && doneAt) || notes.length ? (
        <div className="ml-8 mt-3 rounded-[10px] bg-done/10 px-3 py-2.5">
          <p className="text-xs font-medium text-done">
            What you learned{done && doneAt ? <span className="font-normal text-muted"> · completed {fmtDoneAt(doneAt)}</span> : null}
          </p>
          {notes.map((s) => (
            <p key={s.id} className="mt-1 whitespace-pre-wrap text-sm leading-5 text-ink/90">{s.note}</p>
          ))}
          {!notes.length && <p className="mt-1 text-xs text-muted">No note was written.</p>}
        </div>
      ) : null}

      <div className="ml-8 mt-3 flex flex-wrap items-center gap-2">
        <TaskMaterials goal={g} taskId={task.id} />
        {!linking && (
          <button type="button" onClick={() => setLinking(true)} className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-k-learn">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
              <path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 014.5 9l1-1" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
            </svg>
            Add link
          </button>
        )}
      </div>
      {linking && <AddLink goal={g} taskId={task.id} phaseId={m.id} onDone={() => setLinking(false)} />}
      {panel}
    </li>
  );
}

/** The date and time the task is planned for. Click: change the date and time, or see it in the calendar. */
function When({ goal: g, sessions, slots, done }: { goal: Goal; sessions: Session[]; slots: Record<string, Slot>; done: boolean }) {
  const { apply } = useStore();
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLButtonElement>(null);
  const t = today();
  // The session that matters: the next unfinished one, else the last finished one
  const pending = sessions.filter((s) => !s.done).sort((a, b) => a.date.localeCompare(b.date));
  const s = pending[0] ?? sessions.filter((x) => x.done).sort((a, b) => a.date.localeCompare(b.date)).pop();
  const slot = s ? slots[s.id] : undefined;
  // a block past midnight or of no length means the day had no free time for it
  const placed = slot && !slot.conflict && slot.end > slot.start && slot.start < 1440 ? slot : undefined;
  const [date, setDate] = useState(t);
  const [time, setTime] = useState("");

  if (!s) return <span className="text-xs text-faint">Not scheduled</span>;
  const missed = !s.done && !s.skipped && s.date < t;
  const more = pending.length > 1 ? pending.length - 1 : 0;
  const day = s.date === t ? "Today" : fmtDate(s.date, { weekday: "short", day: "numeric", month: "short" });
  const close = () => { setOpen(false); setChanging(false); };
  const startChange = () => {
    setDate(s.date < t ? t : s.date);
    setTime(s.start ?? (placed ? hhmm(placed.start) : g.prefStart || ""));
    setError("");
    setChanging(true);
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => { setOpen((x) => !x); setChanging(false); }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs tabular-nums transition-colors hover:bg-panel-2 ${
          missed ? "text-late" : s.skipped ? "text-faint line-through" : done ? "text-done" : s.date === t ? "crystal-text" : "text-muted"
        }`}
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
          <rect x="2.5" y="3.5" width="11" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" fill="none" />
          <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        {day}
        {placed ? `, ${clock(placed.start)} – ${clock(placed.end)}` : !s.done && <span className="text-late"> · no free time that day</span>}
        {missed && <span className="hidden sm:inline">· missed</span>}
        {more > 0 && <span className="text-faint">+{more}</span>}
      </button>
      <Popover anchor={ref} open={open} onClose={close} label="When" width={300}>
        {changing ? (
          <form
            className="grid gap-2 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              const err = apply({ type: "move_session", goalId: g.id, sessionId: s.id, date, start: time || undefined });
              if (err) setError(err);
              else close();
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              <label className="grid min-w-0 gap-1 text-xs text-muted">Date<input type="date" className="input w-full min-w-0" value={date} min={t} onChange={(e) => setDate(e.target.value)} required /></label>
              <label className="grid min-w-0 gap-1 text-xs text-muted">Time<input type="time" className="input w-full min-w-0" value={time} onChange={(e) => setTime(e.target.value)} /></label>
            </div>
            {error && <p className="text-xs text-bad" role="alert">{error}</p>}
            <div className="flex gap-2"><button className="btn btn-primary btn-sm">Save</button><button type="button" className="btn btn-quiet btn-sm" onClick={() => setChanging(false)}>Back</button></div>
          </form>
        ) : (
          <>
            {!s.done && (
              <button type="button" className="flex w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-panel-2" onClick={startChange}>
                Change date and time
              </button>
            )}
            <Link href={`/day/${s.date}?session=${s.id}`} className="flex w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-panel-2">
              See in calendar
            </Link>
            {more > 0 && (
              <p className="border-t border-line px-3 py-2 text-xs text-muted">
                Also on{" "}
                {pending.slice(1).map((x, i) => (
                  <span key={x.id}>
                    {i > 0 && ", "}
                    <Link href={`/day/${x.date}?session=${x.id}`} className="hover:text-ink hover:underline">{fmtDate(x.date, { day: "numeric", month: "short" })}</Link>
                  </span>
                ))}
              </p>
            )}
          </>
        )}
      </Popover>
    </>
  );
}

/** Link a Notion page, Drive file, doc, video or local file to one task; it also shows in the week's materials. */
function AddLink({ goal: g, taskId, phaseId, onDone }: { goal: Goal; taskId: string; phaseId: string; onDone: () => void }) {
  const { apply } = useStore();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [msg, setMsg] = useState("");
  return (
    <form
      className="ml-8 mt-3 grid gap-2 rounded-[10px] bg-panel-2/70 p-3 sm:grid-cols-[1fr_12rem_auto_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        const bad = checkMaterialUrl(url);
        if (bad) return setMsg(bad);
        const err = apply({ type: "add_material", goalId: g.id, material: { id: uid() + uid(), url: url.trim(), title: title.trim() || titleFromUrl(url), kind: detectKind(url), taskId, phaseId, addedAt: new Date().toISOString() } });
        if (err) return setMsg(err);
        onDone();
      }}
    >
      <input className="input" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Notion, Drive, doc, video link or a file path" aria-label="Link" />
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name (optional)" aria-label="Name" />
      <button className="btn btn-primary btn-sm">Add</button>
      <button type="button" className="btn btn-quiet btn-sm" onClick={onDone}>Cancel</button>
      {msg && <p className="text-xs text-bad sm:col-span-4" role="alert">{msg}</p>}
    </form>
  );
}

function AddTask({ goal: g, index, onDone }: { goal: Goal; index: number; onDone: () => void }) {
  const { state, addTask } = useStore();
  const [f, setF] = useState({ title: "", minutes: state.settings.defaultTaskMinutes ?? 45, kind: "practice" as TaskKind, detail: "" });
  const max = limitsOf(state).maxTasksPerModule;
  const full = max > 0 && g.roadmap.modules[index].tasks.length >= max;
  if (full) return <p className="mt-2 px-2 py-2 text-xs text-muted">This phase already has the maximum of {max} tasks.</p>;
  return (
    <form
      className="mt-3 grid gap-3 rounded-[14px] bg-panel p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!f.title.trim()) return;
        if (addTask(g.id, index, { ...f, title: f.title.trim() })) setF({ ...f, title: "", detail: "" });
      }}
    >
      <input className="input" autoFocus placeholder="Task name" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label="Task name" />
      <textarea className="input resize-y" rows={3} placeholder="What's in it, one point per line (optional)" value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} aria-label="What's in it" />
      <div className="flex flex-wrap gap-2">
        <KindSelect value={f.kind} onChange={(kind) => setF({ ...f, kind })} />
        <input type="number" min={10} max={600} step={5} className="input w-24" value={f.minutes} onChange={(e) => setF({ ...f, minutes: Number(e.target.value) || 30 })} aria-label="Minutes" />
        <button className="btn btn-primary btn-sm ml-auto">Add</button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onDone}>Cancel</button>
      </div>
      <p className="text-xs text-faint">Scheduled from today, after the work already planned.</p>
    </form>
  );
}
