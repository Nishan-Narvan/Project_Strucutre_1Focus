import "server-only";

/**
 * Reading Notion pages and databases with the person's own integration secret, turned into a
 * small, safe structure the app can lay out (and plain Markdown for assistants).
 * API version 2025-09-03: pages and blocks as before; databases are read through their data sources.
 */

const API = "https://api.notion.com/v1";
const VERSION = "2025-09-03";
const MAX_BLOCKS = 400;
const MAX_DEPTH = 3;
const MAX_ROWS = 100;

export class NotionError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

// ---------------------------------------------------------------- the structure the app renders

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  href?: string;
}

export type NBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: Span[]; children?: NBlock[] }
  | { type: "paragraph" | "quote" | "callout"; text: Span[]; icon?: string; children?: NBlock[] }
  | { type: "bullet" | "number"; text: Span[]; children?: NBlock[] }
  | { type: "todo"; text: Span[]; checked: boolean; children?: NBlock[] }
  | { type: "toggle"; text: Span[]; children?: NBlock[] }
  | { type: "code"; text: string; language: string }
  | { type: "image"; url: string; caption: Span[] }
  | { type: "link"; url: string; label: string }
  | { type: "divider" }
  | { type: "table"; header: boolean; rows: Span[][][] }
  | { type: "columns"; columns: NBlock[][] }
  | { type: "child_page"; id: string; title: string }
  | { type: "database"; db: NDatabase }
  | { type: "unsupported"; kind: string };

export interface NDatabase {
  id: string;
  title: string;
  url: string;
  columns: string[];
  rows: { id: string; url: string; cells: Record<string, string> }[];
  more: boolean;
}

export type NotionDoc =
  | { kind: "page"; id: string; title: string; url: string; icon?: string; cover?: string; properties: { name: string; value: string }[]; blocks: NBlock[]; truncated: boolean }
  | { kind: "database"; id: string; title: string; url: string; icon?: string; db: NDatabase };

// ---------------------------------------------------------------- helpers

/** The 32-character id at the end of a Notion link, as a dashed UUID. */
export function notionId(link: string): string | null {
  let path = link.trim();
  try {
    path = new URL(link).pathname;
  } catch {}
  const hex = path.replace(/-/g, "").match(/[0-9a-f]{32}(?![0-9a-f])/gi);
  const id = hex?.pop();
  return id ? `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`.toLowerCase() : null;
}

type Json = Record<string, unknown> & { [k: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(token: string, path: string, init: RequestInit = {}): Promise<Json> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": VERSION, "Content-Type": "application/json" },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  const data = (await res.json().catch(() => ({}))) as Json;
  if (res.ok) return data;
  if (res.status === 401) throw new NotionError("Notion refused the integration secret. Check it in Settings → Notion.", 401);
  if (res.status === 404 || data.code === "object_not_found")
    throw new NotionError("Notion can't find that page for this integration. In Notion, open the page, click ••• → Connections, and add your integration.", 404);
  if (res.status === 429) throw new NotionError("Notion is rate-limiting; try again in a few seconds.", 429);
  throw new NotionError(`Notion answered ${res.status}: ${String(data.message ?? "").slice(0, 200)}`, 502);
}

const spans = (rich: unknown): Span[] =>
  (Array.isArray(rich) ? rich : []).map((r: Json) => ({
    text: String(r.plain_text ?? ""),
    ...(r.annotations?.bold ? { bold: true } : {}),
    ...(r.annotations?.italic ? { italic: true } : {}),
    ...(r.annotations?.code ? { code: true } : {}),
    ...(r.annotations?.strikethrough ? { strike: true } : {}),
    ...(r.href ? { href: String(r.href) } : {}),
  }));
const plain = (rich: unknown) => spans(rich).map((s) => s.text).join("");
const fileUrl = (f: Json | undefined) => String(f?.file?.url ?? f?.external?.url ?? "");
const iconOf = (o: Json) => (o.icon?.type === "emoji" ? String(o.icon.emoji) : undefined);

/** One property value of a page, as text. */
function propText(p: Json): string {
  switch (p.type) {
    case "title":
    case "rich_text":
      return plain(p[p.type]);
    case "number":
      return p.number === null ? "" : String(p.number);
    case "select":
    case "status":
      return p[p.type]?.name ?? "";
    case "multi_select":
      return (p.multi_select ?? []).map((x: Json) => x.name).join(", ");
    case "date":
      return p.date ? `${p.date.start}${p.date.end ? ` → ${p.date.end}` : ""}` : "";
    case "checkbox":
      return p.checkbox ? "✓" : "";
    case "url":
    case "email":
    case "phone_number":
      return p[p.type] ?? "";
    case "people":
      return (p.people ?? []).map((x: Json) => x.name ?? "").join(", ");
    case "files":
      return (p.files ?? []).map((x: Json) => x.name ?? "file").join(", ");
    case "formula":
      return String(p.formula?.[p.formula?.type] ?? "");
    case "relation":
      return `${(p.relation ?? []).length} linked`;
    case "rollup":
      return p.rollup?.type === "number" ? String(p.rollup.number ?? "") : p.rollup?.type === "array" ? `${(p.rollup.array ?? []).length} items` : "";
    case "created_time":
    case "last_edited_time":
      return String(p[p.type] ?? "").slice(0, 10);
    case "unique_id":
      return `${p.unique_id?.prefix ? `${p.unique_id.prefix}-` : ""}${p.unique_id?.number ?? ""}`;
    default:
      return "";
  }
}

// ---------------------------------------------------------------- reading

interface Budget {
  blocks: number;
  truncated: boolean;
}

async function children(token: string, id: string, depth: number, budget: Budget): Promise<NBlock[]> {
  const out: NBlock[] = [];
  let cursor: string | undefined;
  do {
    const page = await call(token, `/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    for (const b of page.results as Json[]) {
      if (budget.blocks >= MAX_BLOCKS) {
        budget.truncated = true;
        return out;
      }
      budget.blocks++;
      out.push(await block(token, b, depth, budget));
    }
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  // Consecutive list items keep their numbering together; nothing else to group
  return out;
}

async function block(token: string, b: Json, depth: number, budget: Budget): Promise<NBlock> {
  const v = b[b.type] ?? {};
  const kids = async () => (b.has_children && depth < MAX_DEPTH ? await children(token, b.id, depth + 1, budget) : undefined);
  switch (b.type) {
    case "paragraph":
      return { type: "paragraph", text: spans(v.rich_text), children: await kids() };
    case "heading_1":
    case "heading_2":
    case "heading_3":
      return { type: "heading", level: Number(b.type.slice(-1)) as 1 | 2 | 3, text: spans(v.rich_text), children: v.is_toggleable ? await kids() : undefined };
    case "bulleted_list_item":
      return { type: "bullet", text: spans(v.rich_text), children: await kids() };
    case "numbered_list_item":
      return { type: "number", text: spans(v.rich_text), children: await kids() };
    case "to_do":
      return { type: "todo", text: spans(v.rich_text), checked: Boolean(v.checked), children: await kids() };
    case "toggle":
      return { type: "toggle", text: spans(v.rich_text), children: await kids() };
    case "quote":
      return { type: "quote", text: spans(v.rich_text), children: await kids() };
    case "callout":
      return { type: "callout", text: spans(v.rich_text), icon: v.icon?.emoji, children: await kids() };
    case "code":
      return { type: "code", text: plain(v.rich_text), language: String(v.language ?? "") };
    case "image":
      return { type: "image", url: fileUrl(v), caption: spans(v.caption) };
    case "video":
    case "file":
    case "pdf":
    case "audio":
      return { type: "link", url: fileUrl(v), label: plain(v.caption) || v.name || b.type };
    case "bookmark":
    case "embed":
    case "link_preview":
      return { type: "link", url: String(v.url ?? ""), label: plain(v.caption) || String(v.url ?? "") };
    case "divider":
      return { type: "divider" };
    case "table": {
      const rows = b.has_children ? ((await call(token, `/blocks/${b.id}/children?page_size=100`)).results as Json[]) : [];
      budget.blocks += rows.length;
      return { type: "table", header: Boolean(v.has_column_header), rows: rows.map((r) => (r.table_row?.cells ?? []).map((c: unknown) => spans(c))) };
    }
    case "column_list": {
      const cols = b.has_children ? ((await call(token, `/blocks/${b.id}/children?page_size=100`)).results as Json[]) : [];
      return { type: "columns", columns: await Promise.all(cols.map((c) => (depth < MAX_DEPTH ? children(token, c.id, depth + 1, budget) : Promise.resolve([])))) };
    }
    case "child_page":
      return { type: "child_page", id: b.id, title: String(v.title ?? "Untitled") };
    case "child_database":
      try {
        return { type: "database", db: await database(token, b.id) };
      } catch {
        return { type: "unsupported", kind: `database "${v.title ?? ""}" (not shared with the integration)` };
      }
    default:
      return { type: "unsupported", kind: b.type };
  }
}

async function database(token: string, id: string): Promise<NDatabase> {
  const db = await call(token, `/databases/${id}`);
  const title = plain(db.title) || "Untitled database";
  const source = (db.data_sources as Json[] | undefined)?.[0];
  if (!source) return { id, title, url: String(db.url ?? ""), columns: [], rows: [], more: false };
  const schema = await call(token, `/data_sources/${source.id}`);
  const props = Object.entries((schema.properties ?? {}) as Record<string, Json>);
  // Title column first, then the rest in Notion's order
  const columns = [...props.filter(([, p]) => p.type === "title"), ...props.filter(([, p]) => p.type !== "title")].map(([n]) => n).slice(0, 12);
  const q = await call(token, `/data_sources/${source.id}/query`, { method: "POST", body: JSON.stringify({ page_size: MAX_ROWS }) });
  const rows = (q.results as Json[]).map((r) => ({
    id: String(r.id),
    url: String(r.url ?? ""),
    cells: Object.fromEntries(columns.map((c) => [c, r.properties?.[c] ? propText(r.properties[c]) : ""])),
  }));
  return { id, title, url: String(db.url ?? ""), columns, rows, more: Boolean(q.has_more) };
}

/** Read a Notion page or database by link or id. */
export async function readNotion(token: string, link: string): Promise<NotionDoc> {
  const id = notionId(link);
  if (!id) throw new NotionError("That does not look like a Notion page or database link.");
  try {
    const page = await call(token, `/pages/${id}`);
    const props = Object.entries((page.properties ?? {}) as Record<string, Json>);
    const titleProp = props.find(([, p]) => p.type === "title");
    const budget: Budget = { blocks: 0, truncated: false };
    return {
      kind: "page",
      id,
      title: titleProp ? plain(titleProp[1].title) || "Untitled" : "Untitled",
      url: String(page.url ?? ""),
      icon: iconOf(page),
      cover: fileUrl(page.cover) || undefined,
      // A page that is a row of a database has properties worth showing (status, tags, dates…)
      properties: props.filter(([, p]) => p.type !== "title").map(([name, p]) => ({ name, value: propText(p) })).filter((x) => x.value),
      blocks: await children(token, id, 0, budget),
      truncated: budget.truncated,
    };
  } catch (e) {
    if (!(e instanceof NotionError) || e.status !== 404) throw e;
    // Not a page: maybe a database
    const db = await database(token, id);
    return { kind: "database", id, title: db.title, url: db.url, db };
  }
}

// ---------------------------------------------------------------- markdown, for assistants

const md = (s: Span[]) => s.map((x) => (x.href ? `[${x.text}](${x.href})` : x.code ? `\`${x.text}\`` : x.bold ? `**${x.text}**` : x.italic ? `*${x.text}*` : x.text)).join("");

function blockMd(b: NBlock, indent = ""): string[] {
  const sub = (k?: NBlock[]) => (k ?? []).flatMap((c) => blockMd(c, `${indent}  `));
  switch (b.type) {
    case "heading":
      return [`${indent}${"#".repeat(b.level + 1)} ${md(b.text)}`, ...sub(b.children)];
    case "paragraph":
      return [`${indent}${md(b.text)}`, ...sub(b.children)];
    case "quote":
      return [`${indent}> ${md(b.text)}`, ...sub(b.children)];
    case "callout":
      return [`${indent}> ${b.icon ?? "💡"} ${md(b.text)}`, ...sub(b.children)];
    case "bullet":
      return [`${indent}- ${md(b.text)}`, ...sub(b.children)];
    case "number":
      return [`${indent}1. ${md(b.text)}`, ...sub(b.children)];
    case "todo":
      return [`${indent}- [${b.checked ? "x" : " "}] ${md(b.text)}`, ...sub(b.children)];
    case "toggle":
      return [`${indent}- ${md(b.text)}`, ...sub(b.children)];
    case "code":
      return [`${indent}\`\`\`${b.language}`, ...b.text.split("\n").map((l) => indent + l), `${indent}\`\`\``];
    case "image":
      return [`${indent}![${md(b.caption) || "image"}](${b.url})`];
    case "link":
      return [`${indent}[${b.label}](${b.url})`];
    case "divider":
      return [`${indent}---`];
    case "table":
      return b.rows.length ? [`${indent}| ${b.rows[0].map(md).join(" | ")} |`, `${indent}|${b.rows[0].map(() => "---").join("|")}|`, ...b.rows.slice(1).map((r) => `${indent}| ${r.map(md).join(" | ")} |`)] : [];
    case "columns":
      return b.columns.flatMap((c) => c.flatMap((x) => blockMd(x, indent)));
    case "child_page":
      return [`${indent}(sub-page: ${b.title})`];
    case "database":
      return dbMd(b.db, indent);
    default:
      return [];
  }
}

function dbMd(db: NDatabase, indent = ""): string[] {
  if (!db.columns.length) return [`${indent}(database "${db.title}" is empty)`];
  return [`${indent}**${db.title}**`, `${indent}| ${db.columns.join(" | ")} |`, `${indent}|${db.columns.map(() => "---").join("|")}|`, ...db.rows.map((r) => `${indent}| ${db.columns.map((c) => (r.cells[c] ?? "").replace(/\|/g, "/")).join(" | ")} |`), ...(db.more ? [`${indent}(more rows in Notion)`] : [])];
}

export function notionMarkdown(doc: NotionDoc): string {
  if (doc.kind === "database") return [`# ${doc.title}`, "", ...dbMd(doc.db)].join("\n");
  return [`# ${doc.title}`, ...(doc.properties.length ? ["", ...doc.properties.map((p) => `- ${p.name}: ${p.value}`)] : []), "", ...doc.blocks.flatMap((b) => blockMd(b)), ...(doc.truncated ? ["", "(The page is long; the rest is in Notion.)"] : [])].join("\n");
}

// ---------------------------------------------------------------- a short cache, so opening a goal twice does not re-read Notion

const cache = new Map<string, { at: number; doc: NotionDoc }>();
export async function readNotionCached(userId: string, token: string, link: string, fresh = false): Promise<NotionDoc> {
  const key = `${userId}:${notionId(link)}`;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 45000) return hit.doc;
  const doc = await readNotion(token, link);
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), doc });
  return doc;
}
