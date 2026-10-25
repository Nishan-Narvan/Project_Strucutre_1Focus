// @reviewed 2026-10-25
"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { daysBetween, fmtDate, fmtDuration, today } from "@/lib/date";
import { lastSessionDate, overdue, progress, taskSessions } from "@/lib/schedule";
import { Check, ConfirmButton, KindTag, ModuleBar, PageHeader, SourceBadge } from "@/components/ui";
import { Mermaid } from "@/components/Mermaid";
import type { Goal, Module } from "@/lib/types";

export default function GoalPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { state, reschedule, deleteGoal } = useStore();
  const g = state.goals.find((x) => x.id === id);

  if (!g)
    return (
      <div className="card text-muted">
        Goal not found. <Link href="/" className="text-accent">Back to dashboard</Link>
      </div>
    );

  const t = today();
  const p = progress(g);
  const behind = overdue(g, t);
  const rm = g.roadmap;
  const finishes = lastSessionDate(g);

  return (
    <>
      <PageHeader
        title={g.title}
        sub={
          <>
            {g.currentLevel} → {g.targetLevel} · {fmtDate(g.startDate)} – {fmtDate(g.deadline)} · {g.hoursPerDay} h/day ·{" "}
            {daysBetween(t, g.deadline)} days left
          </>
        }
      >
        <ConfirmButton
          onConfirm={() => {
            deleteGoal(g.id);
            router.push("/");
          }}
        >
          Delete goal
        </ConfirmButton>
      </PageHeader>

      <div className="card mb-6">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-sm text-muted">
            {fmtDuration(p.done)} of {fmtDuration(p.total)} · module {p.currentModule + 1} of {rm.modules.length}
          </span>
          <span className="font-serif text-3xl" style={{ color: g.color }}>
            {Math.round(p.pct * 100)}%
          </span>
        </div>
        <ModuleBar goal={g} height="h-3.5" />
        <div className="mt-2 flex text-[10px] text-muted">
          {rm.modules.map((m, i) => (
            <span key={m.id} className="truncate pr-1" style={{ flex: p.modules[i].total || 1 }}>
              {i + 1}. {m.title}
            </span>
          ))}
        </div>
        {(behind.length > 0 || finishes > g.deadline) && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm">
            {behind.length > 0 && <span>{behind.length} missed session(s) ({fmtDuration(behind.reduce((a, s) => a + s.minutes, 0))}).</span>}
            {finishes > g.deadline && <span>Plan currently ends {fmtDate(finishes)}, after the deadline.</span>}
            <button className="btn ml-auto" onClick={() => reschedule(g.id)}>
              Reschedule from today
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-2 font-serif text-xl">Overview</h2>
          <p className="text-sm leading-relaxed text-ink/90">{rm.summary}</p>
          <h3 className="mt-5 mb-2 text-sm font-semibold uppercase tracking-wide text-muted">First principles</h3>
          <ol className="space-y-2">
            {rm.first_principles.map((fp, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium text-accent">{fp.principle}.</span> <span className="text-ink/80">{fp.explanation}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="card">
          <h2 className="mb-3 font-serif text-xl">Zone of Proximal Development</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["Can do alone", rm.zpd.can_do_alone, "text-ok"],
                ["With guidance (start here)", rm.zpd.can_do_with_guidance, "text-accent"],
                ["Out of reach now", rm.zpd.out_of_reach_now, "text-muted"],
              ] as const
            ).map(([label, items, color]) => (
              <div key={label} className="rounded-lg bg-bg p-3">
                <div className={`mb-1.5 text-xs font-semibold uppercase tracking-wide ${color}`}>{label}</div>
                <ul className="list-disc space-y-1 pl-4 text-xs text-ink/85">
                  {items.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-ink/80">
            <span className="text-muted">Strategy:</span> {rm.zpd.strategy}
          </p>
        </section>

        <section className="card">
          <h2 className="mb-3 font-serif text-xl">Roadmap diagram</h2>
          <Mermaid code={rm.diagram_mermaid} />
        </section>

        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-xl">Cross-verification</h2>
            <span className="rounded-full border border-ok/40 px-2.5 py-0.5 text-sm text-ok">{rm.verification.confidence_score}/100 confidence</span>
          </div>
          <p className="text-sm text-ink/85">{rm.verification.consensus_notes}</p>
          <h3 className="mt-4 mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Changes after review</h3>
          <ul className="list-disc space-y-1 pl-4 text-sm text-ink/85">
            {rm.verification.changes_made.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <h3 className="mt-4 mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Open risks</h3>
          <ul className="list-disc space-y-1 pl-4 text-sm text-warn/90">
            {rm.verification.open_risks.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </section>
      </div>

      <h2 className="mt-8 mb-3 font-serif text-2xl">Modules</h2>
      <div className="space-y-3">
        {rm.modules.map((m, i) => (
          <ModuleCard key={m.id} goal={g} module={m} index={i} ratio={p.modules[i].ratio} open={i === p.currentModule} />
        ))}
      </div>
    </>
  );
}

function ModuleCard({ goal: g, module: m, index, ratio, open }: { goal: Goal; module: Module; index: number; ratio: number; open: boolean }) {
  const { setTaskDone, toggleSession } = useStore();
  const t = today();
  return (
    <details open={open} className="card group p-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 text-sm font-semibold" style={{ borderColor: g.color, color: ratio >= 1 ? "#1a1410" : g.color, background: ratio >= 1 ? g.color : "transparent" }}>
          {ratio >= 1 ? "✓" : index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium">{m.title}</div>
          <div className="text-xs text-muted">
            {m.level} · ~{m.estimated_hours} h · {m.tasks.length} daily tasks
          </div>
        </div>
        <div className="hidden w-32 sm:block">
          <div className="h-1.5 overflow-hidden rounded bg-line">
            <div className="h-full" style={{ width: `${ratio * 100}%`, background: g.color }} />
          </div>
        </div>
        <span className="w-10 text-right text-sm text-muted">{Math.round(ratio * 100)}%</span>
        <span className="text-muted transition group-open:rotate-90">›</span>
      </summary>

      <div className="grid gap-5 border-t border-line p-4 lg:grid-cols-[1fr_1.3fr]">
        <div className="space-y-3 text-sm">
          <p><span className="text-muted">Objective:</span> {m.objective}</p>
          <p><span className="text-muted">Built on:</span> <span className="text-accent">{m.first_principle}</span></p>
          <p><span className="text-muted">ZPD scaffold:</span> {m.zpd_scaffold}</p>
          <div className="flex flex-wrap gap-1.5">
            {m.key_concepts.map((k) => (
              <span key={k} className="chip">{k}</span>
            ))}
          </div>
          <p className="rounded-lg bg-bg p-2.5"><span className="text-warn">Checkpoint:</span> {m.checkpoint}</p>

          <h4 className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted">Resources</h4>
          <ul className="space-y-2">
            {m.resources.map((r) => (
              <li key={r.url + r.title} className="flex items-start gap-2">
                <SourceBadge type={r.source_type} />
                <div className="min-w-0">
                  <a href={/^https?:\/\//.test(r.url) ? r.url : undefined} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">
                    {r.title}
                  </a>
                  <span className={`ml-1.5 text-[10px] ${r.verified ? "text-ok" : "text-muted"}`}>{r.verified ? "✓ found in research" : "unverified"}</span>
                  <div className="text-xs text-muted">{r.why}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Daily tasks</h4>
          <ul className="divide-y divide-line">
            {m.tasks.map((task) => {
              const sessions = taskSessions(g, task.id);
              const done = sessions.length > 0 && sessions.every((s) => s.done);
              return (
                <li key={task.id} className="flex gap-3 py-2.5">
                  <Check checked={done} onChange={() => setTaskDone(g.id, task.id, !done)} color={g.color} label={task.title} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className={`text-sm ${done ? "text-muted line-through" : ""}`}>{task.title}</span>
                      <KindTag kind={task.kind} />
                      <span className="text-xs text-muted">{fmtDuration(task.minutes)}</span>
                    </div>
                    {task.detail && <p className="text-xs text-muted">{task.detail}</p>}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {sessions.map((s) => (
                        <span key={s.id} className="inline-flex items-center gap-1">
                          <Link
                            href={`/day/${s.date}`}
                            className={`rounded px-1.5 py-0.5 text-[10px] ${s.done ? "bg-ok/15 text-ok" : s.date < t ? "bg-bad/15 text-bad" : s.date === t ? "bg-accent/20 text-accent" : "bg-panel-2 text-muted"}`}
                          >
                            {fmtDate(s.date)} · {fmtDuration(s.minutes)}
                          </Link>
                          {sessions.length > 1 && (
                            <button className="text-[10px] text-muted hover:text-ink" onClick={() => toggleSession(g.id, s.id)} title="Toggle this part">
                              {s.done ? "↺" : "✓"}
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </details>
  );
}
