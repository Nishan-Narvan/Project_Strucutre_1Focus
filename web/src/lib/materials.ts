import type { Goal, Material, MaterialKind } from "./types";

/**
 * Materials: links to what already exists for a goal (Notion pages, Google Drive folders and files,
 * docs, PDFs, videos, repos) and paths to files on the person's own computer. The app stores the
 * link and where it belongs; an assistant opens it with its own tools (a Notion or Google Drive
 * connector, a browser, or a file-system tool for local paths).
 */

export const MATERIAL_LABEL: Record<MaterialKind, string> = {
  notion: "Notion",
  drive: "Drive file",
  folder: "Folder",
  doc: "Doc",
  sheet: "Sheet",
  slides: "Slides",
  pdf: "PDF",
  video: "Video",
  repo: "Code",
  local: "On my computer",
  link: "Link",
};

/** A path on the person's computer rather than a web address. */
export const isLocalPath = (s: string) => /^file:\/\//i.test(s) || /^[a-z]:[\\/]/i.test(s) || /^\\\\/.test(s) || /^[~/]/.test(s);

/** Work out what a link points to. */
export function detectKind(raw: string): MaterialKind {
  const s = raw.trim();
  if (isLocalPath(s)) return /[\\/]$/.test(s) ? "folder" : s.toLowerCase().endsWith(".pdf") ? "pdf" : "local";
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return "link";
  }
  const h = u.hostname.replace(/^www\./, "");
  const p = u.pathname;
  if (/(^|\.)notion\.(so|site)$/.test(h)) return "notion";
  if (h === "drive.google.com") return /\/folders\//.test(p) ? "folder" : "drive";
  if (h === "docs.google.com") return p.startsWith("/spreadsheets") ? "sheet" : p.startsWith("/presentation") ? "slides" : "doc";
  if (/(^|\.)(dropbox\.com|onedrive\.live\.com|sharepoint\.com|1drv\.ms)$/.test(h)) return /\/(sh|folders?)\//.test(p) ? "folder" : "drive";
  if (/(^|\.)(youtube\.com|youtu\.be|vimeo\.com|loom\.com)$/.test(h)) return "video";
  if (/(^|\.)(github\.com|gitlab\.com|bitbucket\.org)$/.test(h)) return "repo";
  if (p.toLowerCase().endsWith(".pdf")) return "pdf";
  return "link";
}

/** A readable default title from the link itself, so adding a material needs only a paste. */
export function titleFromUrl(raw: string): string {
  const s = raw.trim().replace(/[\\/]+$/, "");
  if (isLocalPath(s)) return decodeURIComponent(s.split(/[\\/]/).pop() || s);
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\./, "");
    // Notion page slugs end in an id: "My-Page-Title-1a2b3c…"
    if (/notion\./.test(host)) {
      const slug = u.pathname.split("/").pop() ?? "";
      const words = slug.replace(/-?[0-9a-f]{32}$/i, "").replace(/-/g, " ").trim();
      if (words) return words;
    }
    const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
    const useful = last && !/^(edit|view|d|folders|u|0|1)$/.test(last) && !/^[A-Za-z0-9_-]{25,}$/.test(last);
    return useful ? `${last.replace(/[-_]+/g, " ")} (${host})` : host;
  } catch {
    return s.slice(0, 80);
  }
}

/** Accept web links and local paths; refuse anything else with a clear reason. */
export function checkMaterialUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return "Paste a link or a file path.";
  if (s.length > 2000) return "That link is too long.";
  if (isLocalPath(s)) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "Only web links (https://) and file paths on your computer are supported.";
    return null;
  } catch {
    return "That is not a link or a file path. Web links start with https://; file paths look like C:/Notes/file.pdf or /Users/you/file.md.";
  }
}

/** Materials for one place in a goal: the goal itself, a phase (and its tasks), or a task. */
export function materialsFor(g: Goal, where: { phaseId?: string; taskId?: string } = {}): Material[] {
  const all = g.materials ?? [];
  if (where.taskId) return all.filter((m) => m.taskId === where.taskId);
  if (where.phaseId) {
    const taskIds = new Set(g.roadmap.modules.find((m) => m.id === where.phaseId)?.tasks.map((t) => t.id) ?? []);
    return all.filter((m) => m.phaseId === where.phaseId || (m.taskId && taskIds.has(m.taskId)));
  }
  return all;
}

/** Where a material is attached, in words. */
export function placeOf(g: Goal, m: Material): string {
  if (m.taskId) {
    for (const [i, p] of g.roadmap.modules.entries()) {
      const t = p.tasks.find((x) => x.id === m.taskId);
      if (t) return `task "${t.title}" (phase ${i + 1})`;
    }
    return "a removed task";
  }
  if (m.phaseId) {
    const i = g.roadmap.modules.findIndex((p) => p.id === m.phaseId);
    return i === -1 ? "a removed phase" : `phase ${i + 1} "${g.roadmap.modules[i].title}"`;
  }
  return "the whole goal";
}
