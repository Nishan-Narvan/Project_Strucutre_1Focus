/**
 * Reads the structure people (and models) already put in phase titles, e.g.
 * "Wk 1 · AWS: cloud, IAM, EC2, S3 | Presales: ecosystem + MEDDPICC"
 *   -> label "Week 1", tracks [{ name: "AWS", topics: "cloud, IAM, EC2, S3" }, { name: "Presales", topics: "ecosystem + MEDDPICC" }]
 * A plain title comes back as one track with no name.
 */
export type PhaseTrack = { name?: string; topics: string };
export type PhaseTitleParts = { label?: string; tracks: PhaseTrack[] };

const UNITS: Record<string, string> = { wk: "Week", week: "Week", w: "Week", mo: "Month", month: "Month", day: "Day", d: "Day", phase: "Phase", module: "Module", sprint: "Sprint", stage: "Stage", step: "Step", part: "Part" };

export function splitPhaseTitle(title: string): PhaseTitleParts {
  let rest = title.trim();
  let label: string | undefined;
  const m = rest.match(/^(wk|week|w|mo|month|day|d|phase|module|sprint|stage|step|part)\.?\s*(\d+(?:\s*[-–]\s*\d+)?)\s*(?:[·:|—–-]\s*|$)/i);
  if (m) {
    label = `${UNITS[m[1].toLowerCase()]} ${m[2].replace(/\s*[-–]\s*/, "–")}`;
    rest = rest.slice(m[0].length).trim();
  }
  const tracks = rest
    .split(/\s+\|\s+|\s+·\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part): PhaseTrack => {
      const c = part.match(/^([^:]{1,32}):\s+(.+)$/);
      return c ? { name: c[1].trim(), topics: c[2].trim() } : { topics: part };
    });
  return { label, tracks: tracks.length ? tracks : [{ topics: title }] };
}

/** A short form for tight places (the road): the track names, or the title itself. */
export function shortPhaseTitle(title: string) {
  const { tracks } = splitPhaseTitle(title);
  const named = tracks.filter((t) => t.name).map((t) => t.name!);
  return named.length === tracks.length && named.length > 0 ? named.join(" · ") : tracks.map((t) => t.name ?? t.topics).join(" · ");
}

/** A task's detail as points: its lines, or else its sentences / ";"-separated parts. */
export function detailPoints(detail: string | undefined): string[] {
  const text = (detail ?? "").trim();
  if (!text) return [];
  const clean = (x: string) => x.replace(/^\s*(?:[-*•–]|\d+[.)])\s+/, "").trim();
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  if (lines.length > 1) return lines;
  return text.split(/;\s+|(?<=[.!?])\s+(?=[A-Z0-9"'(])/).map(clean).map((x) => x.replace(/[.;]$/, "")).filter(Boolean);
}
