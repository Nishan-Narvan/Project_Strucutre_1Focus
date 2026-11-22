// @reviewed 2026-10-25
const pad = (n: number) => String(n).padStart(2, "0");

export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parseYmd = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (s: string, n: number) => {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};

export const today = () => ymd(new Date());

export const weekday = (s: string) => parseYmd(s).getDay();

export const daysBetween = (a: string, b: string) =>
  Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 864e5);

export const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};

export const hhmm = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

/** Minutes after midnight shown as 12-hour time, e.g. "9:30 pm". Storage stays HH:MM. */
export const clock = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${pad(m % 60)} ${h < 12 ? "am" : "pm"}`;
};

/** "19:00" shown as "7:00 pm". */
export const clockOf = (t: string | undefined) => (t && /^\d{1,2}:\d{2}$/.test(t) ? clock(toMin(t)) : t ?? "");

export const fmtDate = (s: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }) =>
  parseYmd(s).toLocaleDateString(undefined, opts);

export const fmtDuration = (min: number) => {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
};

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Display order, Monday first. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const uid = () => Math.random().toString(36).slice(2, 10);
