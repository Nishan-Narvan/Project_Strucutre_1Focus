import { addDays, today } from "./date";
import type { AppState, Goal, Limits } from "./types";

/** Product rules that keep people focused (PRD §6.7). */
export const RULES = {
  maxActiveGoals: 4,
  /** Combined study hours per day across all goals. */
  maxDailyHours: 6,
  /** After this many days a roadmap is locked: tasks can be added, never removed. */
  editWindowDays: 7,
  /** 0 = no limit on tasks in a phase (the person asked for none). */
  maxTasksPerModule: 0,
};

/** The limits in force: the person's own settings, falling back to the defaults above. */
export function limitsOf(state?: Pick<AppState, "settings"> | null): Limits {
  const o = state?.settings?.limits ?? {};
  const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);
  return {
    maxActiveGoals: n(o.maxActiveGoals, RULES.maxActiveGoals),
    maxDailyHours: n(o.maxDailyHours, RULES.maxDailyHours),
    // No limit on tasks a phase any more; an old saved setting is ignored
    maxTasksPerModule: RULES.maxTasksPerModule,
    editWindowDays: n(o.editWindowDays, RULES.editWindowDays),
  };
}

export const lockDate = (g: Goal, days: number = RULES.editWindowDays) => addDays(g.createdAt, days);

/** True while tasks and phases may still be removed. An edit window of 0 days never locks. */
export const isEditable = (g: Goal, days: number = RULES.editWindowDays, on: string = today()) => days === 0 || on < lockDate(g, days);

/** Goals that are being worked on: they count toward the limits and have planned sessions. */
export const isActive = (g: Goal) => !g.status || g.status === "active";

export const committedHours = (goals: Goal[]) => goals.filter(isActive).reduce((a, g) => a + g.hoursPerDay, 0);
