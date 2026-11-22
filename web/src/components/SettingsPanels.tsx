"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { limitsOf, RULES } from "@/lib/rules";
import { SAMPLE_NOTES } from "@/lib/demo";
import { ConfirmButton } from "@/components/ui";
import type { DashboardWidget, Limits } from "@/lib/types";

/** Limits, how assistants may act, week start, default task length. */
export function BehaviourSettings() {
  const { state, apply } = useStore();
  const L = limitsOf(state);
  const [f, setF] = useState<Limits>(L);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const s = state.settings;
  const field = (k: keyof Limits, label: string, help: string, step = 1) => (
    <div>
      <label className="label" htmlFor={`lim-${k}`}>{label}</label>
      <input id={`lim-${k}`} type="number" min={k === "editWindowDays" ? 0 : 1} step={step} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} />
      <p className="mt-1 text-xs text-muted">{help} Default {RULES[k]}.</p>
    </div>
  );
  return (
    <section className="card space-y-5" aria-labelledby="beh-title">
      <h2 id="beh-title" className="text-base font-medium">Limits and behaviour</h2>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const error = apply({ type: "save_settings", patch: { limits: f } });
          setMsg(error ? { text: error, bad: true } : { text: "Limits saved." });
        }}
      >
        {field("maxActiveGoals", "Active goals at once", "Fewer goals get finished.")}
        {field("maxDailyHours", "Study hours a day, all goals", "Across active goals.", 0.5)}
        {field("editWindowDays", "Days a roadmap stays fully editable", "After this, tasks and phases can be added but not removed. 0 = never lock.")}
        <div className="flex items-center gap-3 sm:col-span-2">
          <button className="btn btn-primary">Save limits</button>
          {msg && <span className={`text-sm ${msg.bad ? "text-bad" : "text-muted"}`} role="status">{msg.text}</span>}
        </div>
      </form>

      <div className="space-y-4 border-t border-line pt-5">
        <label className="flex items-start gap-3 text-sm text-ink">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-crystal)]" checked={Boolean(s.autoApplySafe)} onChange={(e) => apply({ type: "save_settings", patch: { autoApplySafe: e.target.checked } })} />
          <span>
            Let assistants make ordinary changes without asking each time
            <span className="block text-xs text-muted">Applies to the in-app assistant and to Claude. Deleting, archiving, replacing a roadmap and changing limits always ask first.</span>
          </span>
        </label>
        <div className="flex flex-wrap gap-6">
          <div>
            <span className="label">Week starts on</span>
            <div className="flex gap-2" role="radiogroup" aria-label="Week starts on">
              {(["mon", "sun"] as const).map((d) => (
                <button key={d} type="button" role="radio" aria-checked={(s.weekStart ?? "mon") === d} className={`btn ${(s.weekStart ?? "mon") === d ? "btn-primary" : ""}`} onClick={() => apply({ type: "save_settings", patch: { weekStart: d } })}>
                  {d === "mon" ? "Monday" : "Sunday"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="def-min">Default task length (minutes)</label>
            <input id="def-min" type="number" min={5} max={600} step={5} className="input w-32" defaultValue={s.defaultTaskMinutes ?? 45} onBlur={(e) => apply({ type: "save_settings", patch: { defaultTaskMinutes: Number(e.target.value) || 45 } })} />
          </div>
        </div>
      </div>
    </section>
  );
}

const WIDGET_LABEL: Record<DashboardWidget, string> = { summary: "Summary line (goals and hours in use)", kpis: "KPIs", goals: "Active goals", paused: "Paused and archived goals" };
const ALL: DashboardWidget[] = ["summary", "kpis", "goals", "paused"];

/** Which sections the Goals page shows, and in what order. */
export function DashboardSettings() {
  const { state, apply } = useStore();
  const shown = state.settings.dashboard?.length ? state.settings.dashboard : ALL;
  const order = [...shown, ...ALL.filter((w) => !shown.includes(w))];
  const save = (next: DashboardWidget[]) => apply({ type: "save_settings", patch: { dashboard: next } });
  const move = (w: DashboardWidget, d: number) => {
    const list = [...shown];
    const i = list.indexOf(w), j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    save(list);
  };
  return (
    <section className="card space-y-4" aria-labelledby="dash-title">
      <h2 id="dash-title" className="text-base font-medium">Goals page sections</h2>
      <ul className="divide-y divide-line border-y border-line">
        {order.map((w) => {
          const on = shown.includes(w);
          return (
            <li key={w} className="flex items-center gap-3 py-2.5 text-sm">
              <label className="flex flex-1 items-center gap-3">
                <input type="checkbox" className="h-4 w-4 accent-[var(--color-crystal)]" checked={on} onChange={(e) => save(e.target.checked ? [...shown, w] : shown.filter((x) => x !== w))} disabled={on && shown.length === 1} />
                <span className={on ? "text-ink" : "text-muted"}>{WIDGET_LABEL[w]}</span>
              </label>
              {on && (
                <>
                  <button type="button" className="text-xs text-faint hover:text-ink" onClick={() => move(w, -1)} aria-label={`Move ${WIDGET_LABEL[w]} up`}>Up</button>
                  <button type="button" className="text-xs text-faint hover:text-ink" onClick={() => move(w, 1)} aria-label={`Move ${WIDGET_LABEL[w]} down`}>Down</button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Export everything, remove sample data, or reset. */
export function DataSettings() {
  const { state, apply, resetDemo } = useStore();
  const sample = new Set(SAMPLE_NOTES.filter(Boolean));
  const seeded = state.goals.reduce((n, g) => n + g.sessions.filter((x) => x.note && sample.has(x.note)).length, 0);
  const demoGoals = state.goals.filter((g) => ["Crack DSA for coding interviews", "Conversational Spanish", "Machine learning foundations"].includes(g.title));

  function exportData() {
    const data = { exported_at: new Date().toISOString(), format: "where-mylife/1", ...state, chat: undefined };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `where-mylife-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="card space-y-4">
      <div className="label">Your data</div>
      <div>
        <button type="button" className="btn" onClick={exportData}>Export everything (JSON)</button>
        <p className="mt-1.5 text-xs text-muted">Goals, roadmaps, sessions, notes, KPIs, routines, events, memories and settings. No keys.</p>
      </div>
      <div>
        <ConfirmButton onConfirm={() => apply({ type: "clear_demo_notes" })}>Remove sample notes{seeded ? ` (${seeded})` : ""}</ConfirmButton>
        <p className="mt-1.5 text-xs text-muted">The repeated example notes the sample goals start with.</p>
      </div>
      {demoGoals.length > 0 && (
        <div>
          <ConfirmButton onConfirm={() => apply({ type: "batch", ops: [{ type: "clear_demo_notes" }, ...demoGoals.map((g) => ({ type: "delete_goal" as const, goalId: g.id }))] })}>Remove the sample goals</ConfirmButton>
          <p className="mt-1.5 text-xs text-muted">Deletes {demoGoals.map((g) => g.title).join(", ")}.</p>
        </div>
      )}
      <div>
        <ConfirmButton onConfirm={resetDemo}>Reset to sample data</ConfirmButton>
        <p className="mt-1.5 text-xs text-muted">Replaces everything with the sample goals; keeps your key, look and connections. Undo can reverse it.</p>
      </div>
    </div>
  );
}
