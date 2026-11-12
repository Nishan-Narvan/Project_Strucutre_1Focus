/** Reading tool arguments strictly, with errors written for the AI that sent them. */

export class ToolInputError extends Error {}

const DAY_NAMES: Record<string, number> = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };

export class Args {
  constructor(private a: Record<string, unknown>) {}

  has(name: string) {
    return this.a[name] !== undefined && this.a[name] !== null && this.a[name] !== "";
  }

  str(name: string, opts: { required?: boolean; max?: number } = {}): string | undefined {
    const v = this.a[name];
    if (v === undefined || v === null || v === "") {
      if (opts.required) throw new ToolInputError(`"${name}" is required.`);
      return undefined;
    }
    if (typeof v !== "string" && typeof v !== "number") throw new ToolInputError(`"${name}" must be text.`);
    const s = String(v).trim();
    if (opts.required && !s) throw new ToolInputError(`"${name}" must not be empty.`);
    return s.slice(0, opts.max ?? 1000);
  }

  req(name: string, max?: number): string {
    return this.str(name, { required: true, max }) as string;
  }

  num(name: string, opts: { required?: boolean; min?: number; max?: number; int?: boolean } = {}): number | undefined {
    const v = this.a[name];
    if (v === undefined || v === null || v === "") {
      if (opts.required) throw new ToolInputError(`"${name}" is required.`);
      return undefined;
    }
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) throw new ToolInputError(`"${name}" must be a number.`);
    if (opts.int && !Number.isInteger(n)) throw new ToolInputError(`"${name}" must be a whole number.`);
    if (opts.min !== undefined && n < opts.min) throw new ToolInputError(`"${name}" must be at least ${opts.min}.`);
    if (opts.max !== undefined && n > opts.max) throw new ToolInputError(`"${name}" must be at most ${opts.max}.`);
    return n;
  }

  bool(name: string): boolean | undefined {
    const v = this.a[name];
    if (v === undefined || v === null) return undefined;
    if (typeof v === "boolean") return v;
    if (v === "true" || v === "false") return v === "true";
    throw new ToolInputError(`"${name}" must be true or false.`);
  }

  date(name: string, opts: { required?: boolean } = {}): string | undefined {
    const s = this.str(name, opts);
    if (s === undefined) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new ToolInputError(`"${name}" must be a date as YYYY-MM-DD.`);
    return s;
  }

  time(name: string, opts: { required?: boolean } = {}): string | undefined {
    const s = this.str(name, opts);
    if (s === undefined) return undefined;
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new ToolInputError(`"${name}" must be a time as HH:MM (24-hour).`);
    return `${m[1].padStart(2, "0")}:${m[2]}`;
  }

  oneOf<T extends string>(name: string, options: readonly T[], opts: { required?: boolean } = {}): T | undefined {
    const s = this.str(name, opts);
    if (s === undefined) return undefined;
    if (!options.includes(s as T)) throw new ToolInputError(`"${name}" must be one of: ${options.join(", ")}.`);
    return s as T;
  }

  list<T = unknown>(name: string, opts: { required?: boolean; max?: number } = {}): T[] | undefined {
    const v = this.a[name];
    if (v === undefined || v === null) {
      if (opts.required) throw new ToolInputError(`"${name}" is required.`);
      return undefined;
    }
    if (!Array.isArray(v)) throw new ToolInputError(`"${name}" must be a list.`);
    if (opts.max !== undefined && v.length > opts.max) throw new ToolInputError(`"${name}" can have at most ${opts.max} items.`);
    return v as T[];
  }

  /** Study days as numbers (0 = Sunday). Accepts ["mon","wed"], [1,3], "weekdays", "every day". */
  days(name: string, opts: { required?: boolean } = {}): number[] | undefined {
    const v = this.a[name];
    if (v === undefined || v === null || v === "") {
      if (opts.required) throw new ToolInputError(`"${name}" is required.`);
      return undefined;
    }
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (/^(every ?day|daily|all)$/.test(s)) return [0, 1, 2, 3, 4, 5, 6];
      if (/^weekdays?$/.test(s)) return [1, 2, 3, 4, 5];
      if (/^weekends?$/.test(s)) return [0, 6];
      return this.daysFrom(name, s.split(/[\s,]+/));
    }
    if (!Array.isArray(v)) throw new ToolInputError(`"${name}" must be a list of days such as ["mon","wed","fri"].`);
    return this.daysFrom(name, v);
  }

  private daysFrom(name: string, items: unknown[]): number[] {
    const out = new Set<number>();
    for (const x of items) {
      const n = typeof x === "number" ? x : DAY_NAMES[String(x).trim().toLowerCase()];
      if (n === undefined || !Number.isInteger(n) || n < 0 || n > 6) throw new ToolInputError(`"${name}": "${String(x)}" is not a day. Use mon, tue, wed, thu, fri, sat, sun.`);
      out.add(n);
    }
    if (!out.size) throw new ToolInputError(`"${name}" needs at least one day.`);
    return [...out].sort();
  }

  raw(name: string): unknown {
    return this.a[name];
  }
}

export const DAY_LABEL = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
