"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { fmtDate, fmtDuration, today } from "@/lib/date";
import { progress, taskSessions } from "@/lib/schedule";
import { isEditable, RULES } from "@/lib/rules";
import { CompleteButton, fmtDoneAt, KindTag, SourceBadge } from "@/components/ui";
import type { Goal, TaskKind } from "@/lib/types";

/** Full-screen view of one phase: how complete it is first, then the work. */
export default function PhasePage() {
  const { id, n } = useParams<{ id: string; n: string }>();
  const { state, completeTask, reopenTask, removeTask } = useStore();
  const g = state.goals.find((x) => x.id === id);
  const index = Number(n) - 1;
  const m = g?.roadmap.modules[index];
  usePhaseNav(g ? `/goals/${g.id}/phase/` : null, index, g?.roadmap.modules.length ?? 0);

  if (!g || !m)
    return (
      <p className="text-muted">
        This phase doesn&apos;t exist. <Link href={g ? `/goals/${g.id}` : "/goals"} className="text-ink underline">Back to the roadmap</Link>
      </p>
    );

  const t = today();
  const p = progress(g);
  const mp = p.modules[index];
  const total = g.roadmap.modules.length;
  const current = index === p.currentModule && mp.ratio < 1;
  const done = mp.ratio >= 1;
  const status = (taskId: string) => {
    const s = taskSessions(g, taskId);
    return s.length > 0 && s.every((x) => x.done);
  };
  const doneTasks = m.tasks.filter((task) => status(task.id)).length;
  const nextTask = m.tasks.find((task) => !status(task.id));
  const remaining = g.sessions.filter((s) => s.moduleIndex === index && !s.done).map((s) => s.date).sort();
  const finishOn = remaining[remaining.length - 1];
  const editable = isEditable(g);

  return (
    <>
      <nav className="mb-6 flex flex-wrap items-center justify-between gap-3 text-sm">
        <Link href={`/goals/${g.id}`} className="text-muted hover:text-ink">
          {g.title}, all phases
        </Link>
        <div className="flex items-center gap-1.5" aria-label="Phases">
          {g.roadmap.modules.map((x, i) => (
            <Link
              key={x.id}
              href={`/goals/${g.id}/phase/${i + 1}`}
              aria-label={`Phase ${i + 1}: ${x.title}`}
              aria-current={i === index ? "page" : undefined}
              className={`h-2 rounded-full transition-all ${i === index ? "w-6 bg-ink" : p.modules[i].ratio >= 1 ? "w-2 bg-muted hover:bg-ink" : "w-2 bg-line hover:bg-muted"}`}
            />
          ))}
          <span className="ml-2 hidden text-xs text-faint sm:inline">Swipe or use ← → keys</span>
        </div>
      </nav>

      {index > 0 && (
        <SideButton dir="prev" href={`/goals/${g.id}/phase/${index}`} label={`Previous phase: ${g.roadmap.modules[index - 1].title}`} />
      )}
      {index < total - 1 && (
        <SideButton dir="next" href={`/goals/${g.id}/phase/${index + 2}`} label={`Next phase: ${g.roadmap.modules[index + 1].title}`} />
      )}

      {/* The screen's one question: how complete is this phase? */}
      <section className="grid min-h-[calc(100dvh-170px)] items-center gap-10 px-10 md:px-12 lg:grid-cols-[1fr_auto]">
        <div className="max-w-xl">
          <p className={`text-sm ${current ? "crystal-text" : "text-muted"}`}>
            Phase {index + 1} of {total}, {done ? "complete" : current ? "in progress" : index > p.currentModule ? "up next on the road" : "not started"}
          </p>
          <h1 className="mt-2 font-serif text-6xl leading-[1.02] tracking-tight md:text-7xl">{m.title}</h1>
          <p className="mt-5 text-lg leading-relaxed text-ink/85">{m.objective}</p>

          <dl className="mt-10 grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-muted">Tasks done</dt>
              <dd className="font-serif text-4xl">{doneTasks}<span className="text-faint">/{m.tasks.length}</span></dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Time put in</dt>
              <dd className="font-serif text-4xl">{fmtDuration(mp.done)}</dd>
              <dd className="text-xs text-faint">of {fmtDuration(mp.total)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">{done ? "Finished" : "Finishes"}</dt>
              <dd className="font-serif text-4xl">{done ? "Done" : finishOn ? fmtDate(finishOn, { day: "numeric", month: "short" }) : "–"}</dd>
            </div>
          </dl>

          {/* one segment per task: the phase's work at a glance */}
          <div className="mt-8 flex gap-1" aria-hidden>
            {m.tasks.map((task) => (
              <span
                key={task.id}
                title={task.title}
                className={`h-2 rounded-full ${status(task.id) ? "bg-ink" : task.id === nextTask?.id && current ? "crystal-dot" : "bg-line"}`}
                style={{ flex: task.minutes }}
              />
            ))}
          </div>

          {nextTask && (
            <p className="mt-6 text-[15px]">
              <span className="text-muted">Next: </span>
              <span className={current ? "crystal-text" : ""}>{nextTask.title}</span>
            </p>
          )}
          <a href="#work" className="btn btn-primary mt-8">See the tasks</a>
        </div>

        <Ring ratio={mp.ratio} current={current} />
      </section>

      <section id="work" className="grid scroll-mt-8 gap-6 pt-10 lg:grid-cols-[1.4fr_1fr]">
        <div className="card">
          <h2 className="mb-1 text-lg font-medium">Tasks</h2>
          <p className="mb-4 text-xs text-muted">Completing one asks what you learned; the note and time stay on the task.</p>
          <ol className="space-y-1">
            {m.tasks.map((task) => {
              const sessions = taskSessions(g, task.id);
              const isDone = status(task.id);
              const doneAt = sessions.filter((s) => s.doneAt).map((s) => s.doneAt!).sort().pop();
              const upcoming = sessions.filter((s) => !s.done);
              const isNext = current && task.id === nextTask?.id;
              return (
                <li key={task.id} className={`flex gap-3 rounded-lg px-3 py-3 ${isNext ? "crystal-ring bg-[#0d1418]" : ""}`}>
                  <CompleteButton done={isDone} current={isNext} title={task.title} onComplete={(note) => completeTask(g.id, task.id, note)} onReopen={() => reopenTask(g.id, task.id)} />
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className={isDone ? "text-muted line-through" : isNext ? "crystal-text" : ""}>{task.title}</span>
                      <KindTag kind={task.kind} />
                      <span className="text-xs text-faint">{fmtDuration(task.minutes)}</span>
                    </div>
                    {task.detail && <p className="mt-0.5 text-xs text-muted">{task.detail}</p>}
                    {isDone && doneAt && <p className="mt-1.5 text-xs text-ink/70">Completed {fmtDoneAt(doneAt)}</p>}
                    {sessions.filter((s) => s.done && s.note).map((s) => (
                      <p key={s.id} className="mt-1 border-l border-faint pl-2 text-xs italic text-ink/75">{s.note}</p>
                    ))}
                    {!isDone && upcoming.length > 0 && (
                      <p className="mt-1 text-xs text-muted">
                        {upcoming.map((s, i) => (
                          <span key={s.id}>
                            {i > 0 && ", "}
                            <Link href={`/day/${s.date}`} className={`hover:text-ink ${s.date < t ? "text-bad" : ""}`}>{s.date === t ? "today" : fmtDate(s.date)}</Link>
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                  {editable && !isDone && (
                    <button className="self-start text-xs text-faint hover:text-bad" onClick={() => removeTask(g.id, task.id)} aria-label={`Remove ${task.title}`}>Remove</button>
                  )}
                </li>
              );
            })}
          </ol>
          <AddTask goal={g} index={index} />
        </div>

        <div className="space-y-6">
          <div className="card space-y-4 text-sm">
            <div><h3 className="text-muted">Built on</h3><p className="mt-0.5">{m.first_principle}</p></div>
            <div><h3 className="text-muted">Support while you learn</h3><p className="mt-0.5">{m.zpd_scaffold}</p></div>
            <div><h3 className="text-muted">You&apos;re done when you can</h3><p className="mt-0.5">{m.checkpoint}</p></div>
            <p className="text-muted">{m.key_concepts.join(", ")}</p>
          </div>
          <div className="card">
            <h3 className="mb-3 text-base font-medium">Resources</h3>
            <ul className="space-y-3">
              {m.resources.map((r) => (
                <li key={r.url + r.title} className="flex items-start gap-2.5 text-sm">
                  <SourceBadge type={r.source_type} />
                  <div className="min-w-0">
                    <a href={/^https?:\/\//.test(r.url) ? r.url : undefined} target="_blank" rel="noreferrer" className="underline decoration-faint underline-offset-2 hover:decoration-ink">{r.title}</a>
                    <span className="ml-1.5 text-xs text-faint">{r.verified ? "found in research" : "not yet verified"}</span>
                    <p className="text-xs text-muted">{r.why}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}

/** Previous/next phase with arrow keys and horizontal swipes. */
function usePhaseNav(base: string | null, index: number, total: number) {
  const router = useRouter();
  useEffect(() => {
    if (!base) return;
    const go = (d: number) => {
      const n = index + d;
      if (n >= 0 && n < total) router.push(`${base}${n + 1}`);
    };
    if (index > 0) router.prefetch(`${base}${index}`);
    if (index < total - 1) router.prefetch(`${base}${index + 2}`);

    // never hijack keys or swipes meant for a field or the note dialog
    const busy = (target: EventTarget | null) =>
      !!document.querySelector("[role=dialog]") || (target instanceof Element && !!target.closest("input, textarea, select, [contenteditable]"));

    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || busy(e.target)) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    let sx = 0, sy = 0, tracking = false;
    const onStart = (e: TouchEvent) => {
      tracking = e.touches.length === 1 && !busy(e.target);
      sx = e.touches[0]?.clientX ?? 0;
      sy = e.touches[0]?.clientY ?? 0;
    };
    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  }, [base, index, total, router]);
}

function SideButton({ dir, href, label }: { dir: "prev" | "next"; href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={`fixed top-1/2 z-30 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-line bg-black/80 text-ink transition hover:border-muted hover:bg-panel-2 ${
        dir === "prev" ? "left-2 md:left-[228px]" : "right-2 md:right-4"
      }`}
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
        <path d={dir === "prev" ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5"} stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

/** Large completion ring; the arc glows crystal while the phase is in progress. */
function Ring({ ratio, current }: { ratio: number; current: boolean }) {
  const r = 140;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative mx-auto aspect-square w-[min(80vw,380px)]" role="img" aria-label={`${Math.round(ratio * 100)}% complete`}>
      <svg viewBox="0 0 320 320" className="h-full w-full -rotate-90">
        <circle cx="160" cy="160" r={r} stroke="#161616" strokeWidth="14" fill="none" />
        <circle
          cx="160"
          cy="160"
          r={r}
          stroke={current ? "#bfe9ff" : "#f4f4f4"}
          strokeWidth="14"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c * ratio} ${c}`}
          style={current ? { filter: "drop-shadow(0 0 10px rgba(191,233,255,0.7))" } : undefined}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className={`font-serif text-8xl leading-none ${current ? "crystal-text" : ""}`}>{Math.round(ratio * 100)}%</div>
          <div className="mt-2 text-sm text-muted">complete</div>
        </div>
      </div>
    </div>
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
