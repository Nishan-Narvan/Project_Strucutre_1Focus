/**
 * The Notion reader against stand-in Notion API replies shaped like the real ones (API 2025-09-03):
 * a page with formatted text, lists, to-dos, a toggle, an image, a simple table, a sub-page and an
 * inline database (read through its data source). Run with: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { notionId, notionMarkdown, readNotion } from "../src/lib/server/notion";

const PAGE = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d";
const DASHED = "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d";
const rt = (text: string, ann: Record<string, boolean> = {}, href?: string) => [{ plain_text: text, annotations: ann, href: href ?? null }];
const blk = (id: string, type: string, value: object, has_children = false) => ({ id, type, has_children, [type]: value });

const routes: Record<string, unknown> = {
  [`GET /v1/pages/${DASHED}`]: { id: DASHED, url: `https://www.notion.so/Japanese-${PAGE}`, icon: { type: "emoji", emoji: "🇯🇵" }, properties: { Name: { type: "title", title: rt("Japanese notes") }, Level: { type: "select", select: { name: "N5" } } } },
  [`GET /v1/blocks/${DASHED}/children`]: {
    has_more: false,
    results: [
      blk("h1", "heading_1", { rich_text: rt("Hiragana") }),
      blk("p1", "paragraph", { rich_text: [...rt("Learn "), ...rt("あいうえお", { bold: true }), ...rt(" first. "), ...rt("Guide", {}, "https://example.com/kana")] }),
      blk("b1", "bulleted_list_item", { rich_text: rt("a = あ") }),
      blk("b2", "bulleted_list_item", { rich_text: rt("i = い") }),
      blk("t1", "to_do", { rich_text: rt("Write each 10 times"), checked: true }),
      blk("tg", "toggle", { rich_text: rt("Tricky pairs") }, true),
      blk("im", "image", { type: "file", file: { url: "https://files.example/kana.png" }, caption: rt("Chart") }),
      blk("tb", "table", { has_column_header: true, table_width: 2 }, true),
      blk("cp", "child_page", { title: "Week 2" }),
      blk("db", "child_database", { title: "Vocabulary" }),
    ],
  },
  "GET /v1/blocks/tg/children": { has_more: false, results: [blk("tg1", "paragraph", { rich_text: rt("シ vs ツ") })] },
  "GET /v1/blocks/tb/children": { has_more: false, results: [blk("r1", "table_row", { cells: [rt("Kana"), rt("Sound")] }), blk("r2", "table_row", { cells: [rt("か"), rt("ka")] })] },
  "GET /v1/databases/db": { id: "db", url: "https://www.notion.so/db", title: rt("Vocabulary"), data_sources: [{ id: "ds1", name: "Vocabulary" }] },
  "GET /v1/data_sources/ds1": { properties: { Meaning: { type: "rich_text" }, Word: { type: "title" }, Learned: { type: "checkbox" } } },
  "POST /v1/data_sources/ds1/query": {
    has_more: false,
    results: [
      { id: "row1", url: "https://www.notion.so/row1", properties: { Word: { type: "title", title: rt("水") }, Meaning: { type: "rich_text", rich_text: rt("water") }, Learned: { type: "checkbox", checkbox: true } } },
      { id: "row2", url: "https://www.notion.so/row2", properties: { Word: { type: "title", title: rt("火") }, Meaning: { type: "rich_text", rich_text: rt("fire") }, Learned: { type: "checkbox", checkbox: false } } },
    ],
  },
};

const seen: string[] = [];
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const u = new URL(String(input));
  const key = `${init?.method ?? "GET"} ${u.pathname}`;
  seen.push(`${key} ${(init?.headers as Record<string, string>)?.["Notion-Version"]}`);
  if (!(key in routes)) return new Response(JSON.stringify({ code: "object_not_found" }), { status: 404 });
  return new Response(JSON.stringify(routes[key]), { status: 200 });
}) as typeof fetch;

test("Notion links: the page id is found in any link shape", () => {
  assert.equal(notionId(`https://www.notion.so/myspace/Japanese-notes-${PAGE}`), DASHED);
  assert.equal(notionId(`https://www.notion.so/${PAGE}?v=abc`), DASHED);
  assert.equal(notionId(DASHED), DASHED);
  assert.equal(notionId("https://www.notion.so/no-id-here"), null);
});

test("a Notion page with text, lists, to-dos, toggle, image, table, sub-page and database is read and laid out", async () => {
  const doc = await readNotion("ntn_test", `https://www.notion.so/Japanese-notes-${PAGE}`);
  assert.equal(doc.kind, "page");
  if (doc.kind !== "page") return;
  assert.equal(doc.title, "Japanese notes");
  assert.equal(doc.icon, "🇯🇵");
  assert.deepEqual(doc.properties, [{ name: "Level", value: "N5" }]);
  const types = doc.blocks.map((b) => b.type);
  assert.deepEqual(types, ["heading", "paragraph", "bullet", "bullet", "todo", "toggle", "image", "table", "child_page", "database"]);
  const toggle = doc.blocks[5];
  assert.ok(toggle.type === "toggle" && toggle.children?.[0].type === "paragraph", "toggle children read");
  const table = doc.blocks[7];
  assert.ok(table.type === "table" && table.rows.length === 2 && table.header);
  const db = doc.blocks[9];
  assert.ok(db.type === "database");
  if (db.type === "database") {
    assert.deepEqual(db.db.columns, ["Word", "Meaning", "Learned"], "title column first");
    assert.deepEqual(db.db.rows.map((r) => r.cells), [{ Word: "水", Meaning: "water", Learned: "✓" }, { Word: "火", Meaning: "fire", Learned: "" }]);
  }
  assert.ok(seen.every((s) => s.endsWith("2025-09-03")), "current API version on every call");
  assert.ok(seen.some((s) => s.startsWith("POST /v1/data_sources/ds1/query")), "database rows read through its data source");

  const md = notionMarkdown(doc);
  for (const piece of ["# Japanese notes", "- Level: N5", "## Hiragana", "Learn **あいうえお** first. [Guide](https://example.com/kana)", "- a = あ", "- [x] Write each 10 times", "シ vs ツ", "![Chart](https://files.example/kana.png)", "| Kana | Sound |", "| か | ka |", "(sub-page: Week 2)", "| Word | Meaning | Learned |", "| 水 | water | ✓ |"])
    assert.ok(md.includes(piece), `markdown has: ${piece}`);
});

test("a page not shared with the integration gives a clear instruction", async () => {
  await assert.rejects(readNotion("ntn_test", "https://www.notion.so/Other-ffffffffffffffffffffffffffffffff"), /Connections, and add your integration/);
});
