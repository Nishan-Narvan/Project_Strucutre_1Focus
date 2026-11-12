import type { AgentTurn, AppState } from "../types";
import { taskIndex } from "../schedule";

/**
 * Retrieval memory. Everything the assistant might need to look back at is turned into
 * small documents (saved memories, earlier conversations, completion notes), and the ones
 * that best match a question are pulled out by keyword relevance.
 *
 * This runs in the browser with no extra model call, so it works with every provider.
 */

export interface Recalled {
  kind: "memory" | "conversation" | "note";
  date: string;
  text: string;
  score: number;
}

const STOP = new Set(
  "a an the and or but if then so of to in on at for from with by about as is are was were be been being am do does did have has had i me my mine you your we our it its this that these those there here what which who when where why how can could should would will just not no yes too very more most much many some any all also than into over under up down out off again only own same such both each few other".split(" "),
);

/** Lowercase words with common endings trimmed, so "missed", "missing" and "miss" meet. */
function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 4 ? w.replace(/(ing|edly|ed|ly|es|s)$/, "") : w));
}

/** Every piece of the past the assistant can look back at. */
function documents(state: AppState, currentOlderTurns: AgentTurn[]): Omit<Recalled, "score">[] {
  const docs: Omit<Recalled, "score">[] = [];
  for (const m of state.memories) docs.push({ kind: "memory", date: m.createdAt, text: m.text });

  // A question and its answer are kept together, since either half may hold the match
  const pairs = (turns: { role: string; text: string }[], date: string) => {
    for (let i = 0; i < turns.length; i++) {
      if (turns[i].role !== "user") continue;
      const answer = turns[i + 1]?.role === "assistant" ? turns[i + 1].text : "";
      docs.push({ kind: "conversation", date, text: `They asked: ${turns[i].text}${answer ? `\nYou answered: ${answer}` : ""}`.slice(0, 900) });
    }
  };
  for (const c of state.pastChats ?? []) pairs(c.turns, c.endedAt);
  pairs(currentOlderTurns.filter((t) => !t.error), "earlier in this conversation");

  for (const g of state.goals) {
    const idx = taskIndex(g);
    for (const s of g.sessions) if (s.done && s.note) docs.push({ kind: "note", date: s.date, text: `${g.title}, "${idx[s.taskId]?.task.title ?? "task"}": ${s.note}` });
  }
  return docs;
}

/**
 * The `limit` documents most relevant to `query`. Words that are rare across the documents
 * count for more than common ones, and short documents are not drowned out by long ones.
 */
export function recall(state: AppState, query: string, opts: { limit?: number; olderTurns?: AgentTurn[]; kinds?: Recalled["kind"][] } = {}): Recalled[] {
  const q = [...new Set(tokens(query))];
  if (!q.length) return [];
  const docs = documents(state, opts.olderTurns ?? []).filter((d) => !opts.kinds || opts.kinds.includes(d.kind));
  if (!docs.length) return [];
  const bags = docs.map((d) => tokens(d.text));
  const avgLen = bags.reduce((a, b) => a + b.length, 0) / bags.length || 1;
  const df: Record<string, number> = {};
  for (const bag of bags) for (const w of new Set(bag)) df[w] = (df[w] || 0) + 1;

  return docs
    .map((d, i) => {
      const bag = bags[i];
      let score = 0;
      for (const w of q) {
        const tf = bag.filter((x) => x === w).length;
        if (!tf) continue;
        const idf = Math.log(1 + (docs.length - df[w] + 0.5) / (df[w] + 0.5));
        score += (idf * tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (bag.length / avgLen)));
      }
      return { ...d, score };
    })
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 5);
}
