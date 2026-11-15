"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { today, uid } from "@/lib/date";
import { AUTO_KPIS, kpiReport, type KpiReport } from "@/lib/kpi";
import type { Kpi, KpiSource } from "@/lib/types";

/** A 28-day line. The target is a dashed rule; the line is crystal when on target. */
function Spark({ r }: { r: KpiReport }) {
  const pts = r.series;
  if (pts.length < 2) return <div className="h-10 text-xs text-faint">Not enough values for a line yet.</div>;
  const vals = [...pts.map((p) => p.value), r.kpi.target];
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (pts.length - 1)) * 200;
  const y = (v: number) => 36 - ((v - lo) / span) * 32;
  return (
    <svg viewBox="0 0 200 40" className="h-10 w-full" role="img" aria-label={`${r.kpi.name}, last 28 days`} preserveAspectRatio="none">
      <line x1="0" x2="200" y1={y(r.kpi.target)} y2={y(r.kpi.target)} stroke="var(--color-faint)" strokeDasharray="3 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <polyline points={pts.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} fill="none" stroke={r.onTarget ? "var(--color-crystal)" : "var(--color-ink)"} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function KpiCard({ k }: { k: Kpi }) {
  const { state, apply } = useStore();
  const r = kpiReport(state, k, today());
  const [value, setValue] = useState("");
  const goal = k.goalId ? state.goals.find((g) => g.id === k.goalId)?.title : null;
  return (
    <li className="card flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{k.name}</p>
          <p className="truncate text-xs text-muted">{goal ?? "Overall"}, {k.source === "manual" ? "logged by you" : "from your data"}</p>
        </div>
        <button type="button" className="text-xs text-faint hover:text-bad" onClick={() => apply({ type: "delete_kpi", kpiId: k.id })} aria-label={`Stop tracking ${k.name}`}>Remove</button>
      </div>
      <p className="font-serif text-3xl leading-none">
        <span className={r.onTarget ? "crystal-text" : ""}>{r.current ?? "–"}</span>
        <span className="ml-1 text-sm text-muted">{k.unit}</span>
      </p>
      <p className="text-xs text-muted">
        Target {k.direction === "up" ? "≥" : "≤"} {k.target} {k.unit}. {r.trend === "not enough data" ? "Too early for a trend." : `Trend: ${r.trend}.`} {r.avg7 !== null && `7-day avg ${r.avg7}.`}
      </p>
      <Spark r={r} />
      {k.source === "manual" && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Number(value);
            if (value.trim() === "" || !Number.isFinite(v)) return;
            if (!apply({ type: "log_kpi_value", kpiId: k.id, value: { id: uid() + uid(), date: today(), value: v } })) setValue("");
          }}
        >
          <input className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={`Today's value (${k.unit || "number"})`} aria-label={`Log ${k.name}`} />
          <button className="btn shrink-0">Log</button>
        </form>
      )}
    </li>
  );
}

const SOURCE_LABEL: Record<KpiSource, string> = {
  manual: "Something I log myself",
  streak: AUTO_KPIS.streak.name,
  completion: AUTO_KPIS.completion.name,
  minutes_week: AUTO_KPIS.minutes_week.name,
  tasks_week: AUTO_KPIS.tasks_week.name,
  pace: "Pace against the plan (days)",
};

function AddKpi({ goalId }: { goalId?: string }) {
  const { apply } = useStore();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ source: "manual" as KpiSource, name: "", unit: "", target: "", direction: "up" as "up" | "down" });
  if (!open) return <button type="button" className="btn" onClick={() => setOpen(true)}>Track a KPI</button>;
  const auto = f.source === "manual" ? null : AUTO_KPIS[f.source];
  return (
    <form
      className="card grid gap-3 p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const kpi: Kpi = {
          id: uid() + uid(),
          goalId,
          source: f.source,
          name: f.name.trim() || auto?.name || "",
          unit: f.unit.trim() || auto?.unit || "",
          target: f.target.trim() === "" ? (auto?.target ?? NaN) : Number(f.target),
          direction: auto && f.source !== "manual" && !f.name ? auto.direction : f.direction,
          frequency: auto?.frequency ?? "weekly",
          values: [],
          createdAt: today(),
        };
        if (!apply({ type: "add_kpi", kpi })) {
          setOpen(false);
          setF({ source: "manual", name: "", unit: "", target: "", direction: "up" });
        }
      }}
    >
      <div className="sm:col-span-2">
        <label className="label" htmlFor="kpi-src">What to track</label>
        <select id="kpi-src" className="input" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value as KpiSource })}>
          {(Object.keys(SOURCE_LABEL) as KpiSource[]).map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
        </select>
        {auto && <p className="mt-1 text-xs text-muted">Computed from your data: {auto.about}.</p>}
      </div>
      <div>
        <label className="label" htmlFor="kpi-name">Name</label>
        <input id="kpi-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={auto?.name ?? "Mock interview score"} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="kpi-target">Target</label>
          <input id="kpi-target" className="input" inputMode="decimal" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder={auto ? String(auto.target) : "70"} />
        </div>
        <div>
          <label className="label" htmlFor="kpi-unit">Unit</label>
          <input id="kpi-unit" className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder={auto?.unit ?? "%"} />
        </div>
      </div>
      {f.source === "manual" && (
        <div>
          <label className="label" htmlFor="kpi-dir">Better when</label>
          <select id="kpi-dir" className="input" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value as "up" | "down" })}>
            <option value="up">higher</option>
            <option value="down">lower</option>
          </select>
        </div>
      )}
      <div className="flex items-end gap-2 sm:col-span-2">
        <button className="btn btn-primary">Start tracking</button>
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

/** KPIs for one goal, or (without goalId) every KPI: overall ones first. */
export function KpiPanel({ goalId, title = "KPIs" }: { goalId?: string; title?: string }) {
  const { state } = useStore();
  const kpis = (state.kpis ?? []).filter((k) => (goalId ? k.goalId === goalId : true)).sort((a, b) => Number(Boolean(a.goalId)) - Number(Boolean(b.goalId)));
  return (
    <section aria-label={title} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-medium">{title}</h2>
        <AddKpi goalId={goalId} />
      </div>
      {kpis.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{kpis.map((k) => <KpiCard key={k.id} k={k} />)}</ul>
      ) : (
        <p className="text-sm text-muted">Nothing tracked yet. Track a number that shows real progress: a mock score, problems solved, or a built-in one like your streak.</p>
      )}
    </section>
  );
}
