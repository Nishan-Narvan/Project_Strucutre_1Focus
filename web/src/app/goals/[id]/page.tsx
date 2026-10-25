"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { daysBetween, fmtDate, fmtDuration, today } from "@/lib/date";
import { lastSessionDate, overdue, progress, taskSessions } from "@/lib/schedule";
import { isEditable, lockDate, RULES } from "@/lib/rules";
import { CompleteButton, ConfirmButton, fmtDoneAt, KindTag, ModuleBar, SourceBadge } from "@/components/ui";
import { Road } from "@/components/Road";
import type { Goal, TaskKind } from "@/lib/types";

export default function GoalPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { state, reschedule, deleteGoal } = useStore();
  const g = state.goals.find((x) => x.id === id);
  const [selected, setSelected] = useState<number | null>(null);

  if (!g)
    return (
      <p className="text-muted">
        This goal no longer exists. <Link href="/goals" className="text-ink underline">See all goals</Link>
      </p>
    );

  const t = today();
  const p = progress(g);
  const behind = overdue(g, t);
  const finishes = lastSessionDate(g);
  const sel = selected ?? p.currentModule;
  const editable = isEditable(g);

  return (
    <>
      <header className="mb-8 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <p className="text-sm text-muted">
            {g.currentLevel} to {g.targetLevel}, {daysBetween(t, g.deadline)} days left
          </p>
          <h1 className="mt-1 font-serif text-5xl leading-[1.05] tracking-tight">{g.title}</h1>
          <p className="mt-3 text-sm text-muted">
            Daily habit: {fmtDuration(g.hoursPerDay * 60)} from {g.prefStart}.{" "}
            {editable ? `Roadmap can be changed until ${fmtDate(lockDate(g))}.` : `Locked since ${fmtDate(lockDate(g))}: you can add tasks, not remove them.`}
          </p>
        </div>
        <div className="md:text-right">
          <div className="font-serif text-6xl leading-none">{Math.round(p.pct * 100)}%</div>
          <div className="mt-1 text-sm text-muted">
            {fmtDuration(p.done)} of {fmtDuration(p.total)}
          </div>
        </div>
      </header>

      <ModuleBar goal={g} />

      {(behind.length > 0 || finishes > g.deadline) && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[10px] border border-bad/40 px-4 py-3 text-sm">
          {behind.length > 0 && <span>You missed {behind.length} session{behind.length > 1 ? "s" : ""} ({fmtDuration(behind.reduce((a, s) => a + s.minutes, 0))}).</span>}
          {finishes > g.deadline && <span>At this pace you finish on {fmtDate(finishes)}, after the deadline.</span>}
          <button className="btn ml-auto" onClick={() => reschedule(g.id)}>Reschedule from today</button>
        </div>
      )}

      <section aria-label="Roadmap" className="mt-8">
        <Road goal={g} selected={sel} onSelect={setSelected} />
      </section>

      <ModulePanel key={g.roadmap.modules[sel].id} goal={g} index={sel} editable={editable} />

      <details className="card mt-8 p-0">
        <summary className="cursor-pointer p-5 text-base font-medium">How this roadmap was built</summary>
        <div className="grid gap-8 border-t border-line p-5 lg:grid-cols-3">
          <div>
            <h3 className="mb-2 text-sm font-medium">First principles</h3>
            <ol className="list-decimal space-y-2 pl-4 text-sm text-ink/85">
              {g.roadmap.first_principles.map((fp) => (
                <li key={fp.principle}>
                  <span className="text-ink">{fp.principle}.</span> <span className="text-muted">{fp.explanation}</span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium">Your zone of proximal development</h3>
            <dl className="space-y-2 text-sm">
              <dt className="text-muted">You can already</dt>
              <dd>{g.roadmap.zpd.can_do_alone.join("; ")}</dd>
              <dt className="text-muted">With guidance, where this starts</dt>
              <dd className="crystal-text">{g.roadmap.zpd.can_do_with_guidance.join("; ")}</dd>
              <dt className="text-muted">Out of reach for now</dt>
              <dd>{g.roadmap.zpd.out_of_reach_now.join("; ")}</dd>
            </dl>
            <p className="mt-3 text-sm text-muted">{g.roadmap.zpd.strategy}</p>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium">Cross-checked against sources, {g.roadmap.verification.confidence_score}/100 confidence</h3>
            <p className="text-sm text-ink/85">{g.roadmap.verification.consensus_notes}</p>
            <ul className="mt-3 list-disc space-y-1 pl-4 text-sm text-muted">
              {g.roadmap.verification.changes_made.map((x) => <li key={x}>{x}</li>)}
            </ul>
          </div>
        </div>
      </details>

      <div className="mt-8 flex justify-end">
        <ConfirmButton onConfirm={() => { deleteGoal(g.id); router.push("/goals"); }}>Delete goal</ConfirmButton>
      </div>
    </>
  );
}

function ModulePanel({ goal: g, index, editable }: { goal: Goal; index: number; editable: boolean }) {
  const { completeTask, reopenTask, removeTask } = useStore();
  const p = progress(g);
  const m = g.roadmap.modules[index];
  const mp = p.modules[index];
  const t = today();
  const doneTasks = m.tasks.filter((task) => { const s = taskSessions(g, task.id); return s.length > 0 && s.every((x) => x.done); }).length;
  const nextTaskId = index === p.currentModule ? m.tasks.find((task) => taskSessions(g, task.id).some((s) => !s.done))?.id : undefined;

  return (
    <section aria-labelledby="module-title" className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.35fr]">
      <div className="card">
        <p className="text-sm text-muted">Phase {index + 1} of {g.roadmap.modules.length}, {m.level}</p>
        <h2 id="module-title" className="mt-1 font-serif text-3xl leading-tight">{m.title}</h2>
        <div className="mt-4 flex items-baseline gap-3">
          <span className="font-serif text-4xl">{Math.round(mp.ratio * 100)}%</span>
          <span className="text-sm text-muted">
            {doneTasks} of {m.tasks.length} tasks, {fmtDuration(mp.done)} of {fmtDuration(mp.total)}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
          <div className={`h-full ${index === p.currentModule && mp.ratio < 1 ? "crystal-dot" : "bg-ink"}`} style={{ width: `${mp.ratio * 100}%` }} />
        </div>

        <p className="mt-5 text-[15px] leading-relaxed">{m.objective}</p>
        <dl className="mt-4 space-y-3 text-sm">
          <div><dt className="text-muted">Built on</dt><dd>{m.first_principle}</dd></div>
          <div><dt className="text-muted">Support while you learn</dt><dd>{m.zpd_scaffold}</dd></div>
          <div><dt className="text-muted">You&apos;re done when you can</dt><dd>{m.checkpoint}</dd></div>
        </dl>
        <p className="mt-4 text-sm text-muted">{m.key_concepts.join(", ")}</p>

        <h3 className="mt-6 mb-2 text-sm font-medium">Resources</h3>
        <ul className="space-y-3">
          {m.resources.map((r) => (
            <li key={r.url + r.title} className="flex items-start gap-2.5 text-sm">
              <SourceBadge type={r.source_type} />
              <div className="min-w-0">
                <a href={/^https?:\/\//.test(r.url) ? r.url : undefined} target="_blank" rel="noreferrer" className="underline decoration-faint underline-offset-2 hover:decoration-ink">
                  {r.title}
                </a>
                <span className="ml-1.5 text-xs text-faint">{r.verified ? "found in research" : "not yet verified"}</span>
                <p className="text-xs text-muted">{r.why}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h3 className="mb-1 text-base font-medium">Tasks</h3>
        <p className="mb-4 text-xs text-muted">Each task is scheduled into your daily habit. Completing one asks what you learned.</p>
        <ol className="space-y-1">
          {m.tasks.map((task) => {
            const sessions = taskSessions(g, task.id);
            const done = sessions.length > 0 && sessions.every((s) => s.done);
            const notes = sessions.filter((s) => s.done && s.note);
            const doneAt = sessions.filter((s) => s.doneAt).map((s) => s.doneAt!).sort().pop();
            const upcoming = sessions.filter((s) => !s.done);
            const current = task.id === nextTaskId;
            return (
              <li key={task.id} className={`flex gap-3 rounded-lg px-3 py-3 ${current ? "crystal-ring bg-[#0d1418]" : ""}`}>
                <CompleteButton done={done} current={current} title={task.title} onComplete={(n) => completeTask(g.id, task.id, n)} onReopen={() => reopenTask(g.id, task.id)} />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className={done ? "text-muted line-through" : current ? "crystal-text" : ""}>{task.title}</span>
                    <KindTag kind={task.kind} />
                    <span className="text-xs text-faint">{fmtDuration(task.minutes)}</span>
                  </div>
                  {task.detail && <p className="mt-0.5 text-xs text-muted">{task.detail}</p>}
                  {done && doneAt && <p className="mt-1.5 text-xs text-ink/70">Completed {fmtDoneAt(doneAt)}</p>}
                  {notes.map((s) => (
                    <p key={s.id} className="mt-1 border-l border-faint pl-2 text-xs italic text-ink/75">{s.note}</p>
                  ))}
                  {!done && upcoming.length > 0 && (
                    <p className="mt-1 text-xs text-muted">
                      {upcoming.map((s, i) => (
                        <span key={s.id}>
                          {i > 0 && ", "}
                          <Link href={`/day/${s.date}`} className={`hover:text-ink ${s.date < t ? "text-bad" : ""}`}>
                            {s.date === t ? "today" : fmtDate(s.date)}
                          </Link>
                        </span>
                      ))}
                    </p>
                  )}
                </div>
                {editable && !done && (
                  <button className="self-start text-xs text-faint hover:text-bad" onClick={() => removeTask(g.id, task.id)} aria-label={`Remove ${task.title}`}>
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ol>
        <AddTask goal={g} index={index} />
      </div>
    </section>
  );
}

function AddTask({ goal: g, index }: { goal: Goal; index: number }) {
  const { addTask } = useStore();
  const [f, setF] = useState({ title: "", minutes: 45, kind: "practice" as TaskKind });
  const full = g.roadmap.modules[index].tasks.length >= RULES.maxTasksPerModule;
  return (
    <form
      className="mt-5 border-t border-line pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!f.title.trim()) return;
        if (addTask(g.id, index, { ...f, title: f.title.trim(), detail: "" })) setF({ ...f, title: "" });
      }}
    >
      <label htmlFor="new-task" className="label">Add a task to this phase</label>
      <div className="flex flex-wrap gap-2">
        <input id="new-task" className="input min-w-48 flex-1" placeholder="e.g. Re-solve three problems I got wrong" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} disabled={full} />
        <select className="input w-auto" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as TaskKind })} aria-label="Kind">
          <option value="learn">Learn</option>
          <option value="practice">Practice</option>
          <option value="project">Project</option>
          <option value="review">Review</option>
        </select>
        <input type="number" min={10} max={240} step={5} className="input w-24" value={f.minutes} onChange={(e) => setF({ ...f, minutes: Number(e.target.value) || 30 })} aria-label="Minutes" />
        <button className="btn" disabled={full}>Add</button>
      </div>
      <p className="mt-2 text-xs text-muted">
        {full ? `This phase already has the maximum of ${RULES.maxTasksPerModule} tasks.` : "New tasks are scheduled from today, after the work already planned."}
      </p>
    </form>
  );
}
