"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useStore } from "@/lib/store";
import { addDays, daysBetween, fmtDate, fmtDuration, today } from "@/lib/date";
import { overdue, progress, taskSessions } from "@/lib/schedule";
import { PhaseEditor } from "@/components/Editors";
import { MaterialsPanel } from "@/components/Materials";
import { NotionNotes } from "@/components/NotionView";
import { WeekDates } from "@/components/WeekDates";
import { PhaseTitle } from "@/components/PhaseList";
import { TaskList } from "@/components/TaskList";
import { SourceBadge } from "@/components/ui";
import { splitPhaseTitle } from "@/lib/phaseTitle";
import type { Goal } from "@/lib/types";

/** One phase: where it stands in a few lines, then its tasks as a list of cards. */
export default function PhasePage() {
  const { id, n } = useParams<{ id: string; n: string }>();
  const { state, reschedule } = useStore();
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

  const p = progress(g);
  const mp = p.modules[index];
  const total = g.roadmap.modules.length;
  const current = index === p.currentModule && mp.ratio < 1;
  const done = mp.ratio >= 1;
  const isDone = (taskId: string) => {
    const s = taskSessions(g, taskId);
    return s.length > 0 && s.every((x) => x.done);
  };
  const doneTasks = m.tasks.filter((task) => isDone(task.id)).length;
  const nextTask = m.tasks.find((task) => !isDone(task.id));
  const mine = g.sessions.filter((s) => s.moduleIndex === index);
  const remaining = mine.filter((s) => !s.done).map((s) => s.date).sort();
  const finishedOn = mine.filter((s) => s.doneAt).map((s) => s.doneAt!.slice(0, 10)).sort().pop();
  const finish = done ? finishedOn : remaining[remaining.length - 1];
  const expected = expectedFinish(g, index);
  const late = !!finish && !!expected && finish > expected;
  const pct = Math.round(mp.ratio * 100);
  const missed = overdue(g, today()).filter((s) => s.moduleIndex === index);

  return (
    <>
      <div className="mx-auto max-w-6xl">
      <Link href={`/goals/${g.id}`} className="mb-4 inline-block text-sm text-muted hover:text-ink">
        ← {g.title}, all weeks
      </Link>

      {/* This week, in its own panel: switch weeks at the top, then where it stands */}
      <section
        className={`rounded-[20px] border p-5 sm:p-8 ${done ? "border-done/30" : current ? "border-crystal/30" : "border-line"}`}
        style={{ background: `color-mix(in srgb, var(${done ? "--done" : current ? "--crystal" : "--muted"}) 6%, var(--s2))` }}
      >
        <div className="mb-6 flex items-center justify-between gap-3">
          <WeekStep goalId={g.id} to={index - 1} total={total} dir="prev" label={index > 0 ? splitPhaseTitle(g.roadmap.modules[index - 1].title).label ?? `Week ${index}` : ""} />
          <div className="flex flex-wrap items-center justify-center gap-1.5" aria-label="Weeks">
            {g.roadmap.modules.map((x, i) => (
              <Link
                key={x.id}
                href={`/goals/${g.id}/phase/${i + 1}`}
                aria-label={`Week ${i + 1}: ${x.title}`}
                aria-current={i === index ? "page" : undefined}
                className={`h-2 rounded-full transition-[width,background-color] ${i === index ? "w-6 bg-ink" : p.modules[i].ratio >= 1 ? "w-2 bg-done hover:bg-ink" : i === p.currentModule ? "w-2 bg-crystal hover:bg-ink" : "w-2 bg-line hover:bg-muted"}`}
              />
            ))}
          </div>
          <WeekStep goalId={g.id} to={index + 1} total={total} dir="next" label={index < total - 1 ? splitPhaseTitle(g.roadmap.modules[index + 1].title).label ?? `Week ${index + 2}` : ""} />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="font-medium">{splitPhaseTitle(m.title).label ?? `Week ${index + 1}`}</span>
          <span className="text-muted">{index + 1} of {total}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${done ? "bg-done/15 text-done" : current ? "bg-crystal/15 text-crystal" : "bg-panel text-muted"}`}>
            {done ? "Complete" : current ? "In progress" : index > p.currentModule ? "Up next" : "Not started"}
          </span>
          <WeekDates goal={g} index={index} />
        </div>

        {/* the title, set apart by its border */}
        <h1 className={`mt-3 border-l-4 pl-4 ${done ? "border-done" : current ? "border-crystal" : "border-muted"}`} aria-label={m.title}>
          <PhaseTitle title={m.title} size="hero" />
        </h1>

        {(m.objective || m.checkpoint) && (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {m.objective && (
              <div className="rounded-[14px] bg-bg/50 px-4 py-3.5">
                <p className="text-xs font-medium text-muted">This week&apos;s aim</p>
                <p className="mt-1 text-[15px] leading-relaxed text-ink/90">{m.objective}</p>
              </div>
            )}
            {m.checkpoint && (
              <div className="rounded-[14px] bg-done/[0.08] px-4 py-3.5">
                <p className="text-xs font-medium text-done">You&apos;re done when you can</p>
                <p className="mt-1 text-[15px] leading-relaxed text-ink/90">{m.checkpoint}</p>
              </div>
            )}
          </div>
        )}
        <PhaseEditor key={m.id} goal={g} index={index} />

        <dl className="mt-6 grid grid-cols-3 divide-x divide-line rounded-[14px] bg-bg/50 text-sm">
          <Stat label="Tasks done"><span className={doneTasks === m.tasks.length && m.tasks.length ? "text-done" : ""}>{doneTasks}</span><span className="text-faint">/{m.tasks.length}</span></Stat>
          <Stat label="Time put in">{fmtDuration(mp.done)}<span className="text-faint"> / {fmtDuration(mp.total)}</span></Stat>
          <Stat label={done ? "Finished / expected" : "Finishes / expected"}>
            <span className={late ? "text-late" : ""}>{finish ? fmtDate(finish, { day: "numeric", month: "short" }) : "–"}</span>
            <span className="text-faint"> / {expected ? fmtDate(expected, { day: "numeric", month: "short" }) : "–"}</span>
          </Stat>
        </dl>

        <ProgressLine pct={pct} current={current} done={done} left={mp.total - mp.done} tasksLeft={m.tasks.length - doneTasks} />

        {nextTask && (
          <button type="button" onClick={() => goToTask(nextTask.id)} className="group mt-4 flex items-center gap-2 text-left text-[15px]">
            <span className={`h-2 w-2 shrink-0 rounded-full ${current ? "crystal-dot" : "bg-muted"}`} aria-hidden />
            <span className="text-muted">Next:</span>
            <span className={`underline decoration-transparent underline-offset-4 transition-colors group-hover:decoration-current ${current ? "crystal-text" : ""}`}>{nextTask.title}</span>
          </button>
        )}
        {missed.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-late">
              {missed.length} session{missed.length > 1 ? "s" : ""} missed in this week ({fmtDuration(missed.reduce((a, s) => a + s.minutes, 0))})
            </span>
            <button type="button" className="btn btn-sm" onClick={() => reschedule(g.id)}>Reschedule from today</button>
          </div>
        )}
      </section>

      <section className="mt-10 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <TaskList goal={g} index={index} current={current} />

        <div className="space-y-6">
          {m.notes && (
            <div className="card text-sm">
              <h3 className="text-muted">Details</h3>
              <p className="mt-1 whitespace-pre-wrap leading-relaxed">{m.notes}</p>
            </div>
          )}
          {(m.first_principle || m.zpd_scaffold || m.key_concepts.length > 0) && (
            <div className="card space-y-4 text-sm">
              {m.first_principle && <div><h3 className="text-muted">Built on</h3><p className="mt-0.5">{m.first_principle}</p></div>}
              {m.zpd_scaffold && <div><h3 className="text-muted">Support while you learn</h3><p className="mt-0.5">{m.zpd_scaffold}</p></div>}
              {m.key_concepts.length > 0 && <p className="text-muted">{m.key_concepts.join(", ")}</p>}
            </div>
          )}
          <MaterialsPanel key={m.id} goal={g} phaseId={m.id} />
          {m.resources.length > 0 && (
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
          )}
        </div>
        <div className="lg:col-span-2">
          <NotionNotes key={m.id} goal={g} phaseId={m.id} />
        </div>
      </section>
      </div>
    </>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 px-3 py-2.5 sm:px-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 tabular-nums">{children}</dd>
    </div>
  );
}

/** The week as a line from start to finish, with a dot where you are and what is left. */
function ProgressLine({ pct, current, done, left, tasksLeft }: { pct: number; current: boolean; done: boolean; left: number; tasksLeft: number }) {
  const color = done ? "bg-done" : current ? "bg-crystal" : "bg-ink";
  return (
    <div className="mt-6" role="img" aria-label={`${pct}% done, ${tasksLeft} tasks and ${fmtDuration(left)} left`}>
      <div className="relative h-5">
        <span className={`absolute top-0 -translate-x-1/2 whitespace-nowrap text-xs font-medium ${done ? "text-done" : current ? "crystal-text" : "text-ink"}`} style={{ left: `clamp(2rem, ${pct}%, calc(100% - 2rem))` }}>
          {pct}% done
        </span>
      </div>
      <div className="relative h-3">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-line" />
        <div className={`absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
        <span
          className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg ${color}`}
          style={{ left: `${pct}%`, ...(current ? { boxShadow: "0 0 10px var(--glow)" } : {}) }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-muted">
        <span>Start</span>
        <span>
          {left > 0 || tasksLeft > 0 ? (
            <>
              <span className="text-ink">{tasksLeft}</span> task{tasksLeft === 1 ? "" : "s"} · <span className="text-ink">{fmtDuration(left)}</span> left
            </>
          ) : (
            <span className="text-done">All done</span>
          )}
        </span>
      </div>
    </div>
  );
}

/** Scroll to a task's card and flash it. */
function goToTask(taskId: string) {
  const el = document.getElementById(`task-${taskId}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.animate([{ boxShadow: "0 0 0 3px var(--crystal)" }, { boxShadow: "0 0 0 0 transparent" }], { duration: 1800, easing: "ease-out" });
}

/** Previous or next week, inside the week panel. */
function WeekStep({ goalId, to, total, dir, label }: { goalId: string; to: number; total: number; dir: "prev" | "next"; label: string }) {
  if (to < 0 || to >= total) return <span className="w-24 shrink-0" aria-hidden />;
  return (
    <Link
      href={`/goals/${goalId}/phase/${to + 1}`}
      className={`btn btn-sm w-24 shrink-0 gap-1 ${dir === "next" ? "justify-end" : "justify-start"}`}
      aria-label={`${dir === "prev" ? "Previous" : "Next"} week: ${label}`}
    >
      {dir === "prev" && <span aria-hidden>←</span>}
      <span className="truncate">{label}</span>
      {dir === "next" && <span aria-hidden>→</span>}
    </Link>
  );
}

/** When this phase should be done for the goal to end on its deadline at an even pace. */
function expectedFinish(g: Goal, index: number) {
  const mins = g.roadmap.modules.map((m) => m.tasks.reduce((a, t) => a + t.minutes, 0));
  const all = mins.reduce((a, b) => a + b, 0);
  if (!all || !g.startDate || !g.deadline) return undefined;
  const upTo = mins.slice(0, index + 1).reduce((a, b) => a + b, 0);
  return addDays(g.startDate, Math.round(daysBetween(g.startDate, g.deadline) * (upTo / all)));
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

