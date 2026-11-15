"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { daysBetween, fmtDate, fmtDuration, today } from "@/lib/date";
import { lastSessionDate, overdue, progress } from "@/lib/schedule";
import { isEditable, limitsOf, lockDate } from "@/lib/rules";
import { ModuleBar } from "@/components/ui";
import { GoalEditor, MemoryFileButtons, NoRoadmap, PhaseList, StatusBanner, StudyLog } from "@/components/Editors";
import { MaterialsPanel } from "@/components/Materials";
import { NotionNotes } from "@/components/NotionView";
import { KpiPanel } from "@/components/Kpis";
import { Road } from "@/components/Road";

export default function GoalPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { state, reschedule } = useStore();
  const g = state.goals.find((x) => x.id === id);

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
  const windowDays = limitsOf(state).editWindowDays;
  const editable = isEditable(g, windowDays);

  return (
    <>
      <StatusBanner goal={g} />
      <header className="mb-8 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <p className="text-sm text-muted">
            {g.currentLevel} to {g.targetLevel}, {daysBetween(t, g.deadline)} days left
          </p>
          <h1 className="mt-1 font-serif text-5xl leading-[1.05] tracking-tight">{g.title}</h1>
          <p className="mt-3 text-sm text-muted">
            Daily habit: {fmtDuration(g.hoursPerDay * 60)} from {g.prefStart}.{" "}
            {windowDays === 0 ? "Roadmap can always be changed." : editable ? `Roadmap can be changed until ${fmtDate(lockDate(g, windowDays))}.` : `Locked since ${fmtDate(lockDate(g, windowDays))}: you can add tasks, not remove them.`}
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

      {g.roadmap.modules.length === 0 ? (
        <NoRoadmap goal={g} />
      ) : (
        <section aria-label="Roadmap" className="mt-8">
          <Road goal={g} selected={-1} onSelect={(i) => router.push(`/goals/${g.id}/phase/${i + 1}`)} />
          <p className="mt-2 text-xs text-muted">Open a phase to see its progress, tasks and resources.</p>
          <PhaseList goal={g} />
        </section>
      )}

      <div className="mt-8 space-y-6">
        <NotionNotes goal={g} />
        <MaterialsPanel goal={g} />
      </div>
      <div className="mt-6">
        <MemoryFileButtons goalId={g.id} label="Memory file for another model" />
      </div>

      <div className="mt-8">
        <KpiPanel goalId={g.id} title="KPIs for this goal" />
      </div>
      <StudyLog goal={g} />

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

      <GoalEditor goal={g} />
    </>
  );
}
