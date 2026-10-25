import { addDays, today } from "./date";
import type { Goal } from "./types";

/** Product rules that keep people focused (PRD §6.7). */
export const RULES = {
  maxActiveGoals: 4,
  /** Combined study hours per day across all goals. */
  maxDailyHours: 6,
  /** After this many days a roadmap is locked: tasks can be added, never removed. */
  editWindowDays: 7,
  maxTasksPerModule: 12,
};

export const lockDate = (g: Goal) => addDays(g.createdAt, RULES.editWindowDays);

/** True while tasks may still be removed or changed. */
export const isEditable = (g: Goal) => today() < lockDate(g);

export const committedHours = (goals: Goal[]) => goals.reduce((a, g) => a + g.hoursPerDay, 0);
