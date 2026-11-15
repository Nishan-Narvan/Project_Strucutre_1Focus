import { test } from "node:test";
import assert from "node:assert/strict";
import { connectBest } from "../src/lib/server/models";
import { rankModels } from "../src/lib/providers";

/** A stand-in provider: each model answers after `ms` with `status`. */
function provider(models: Record<string, { status: number; ms: number }>) {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/models")) return new Response(JSON.stringify({ data: Object.keys(models).map((id) => ({ id })) }), { status: 200 });
    const { model } = JSON.parse(String(init?.body));
    calls.push(model);
    const m = models[model];
    return new Promise<Response>((resolve, reject) => {
      const t = setTimeout(() => resolve(new Response(JSON.stringify(m.status === 200 ? { choices: [{ message: { content: "ok" } }] } : { error: { message: `status ${m.status}` } }), { status: m.status })), m.ms);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}

const NAMES = ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "qwen/qwen3-32b", "llama-3.1-8b-instant", "gemma2-9b-it", "mixtral-8x7b-32768"];
const ranked = rankModels("groq", NAMES);

test("tests the best models at the same time and keeps the best one that answers", async () => {
  const p = provider({
    [ranked[0]]: { status: 429, ms: 300 }, // out of quota
    [ranked[1]]: { status: 404, ms: 300 }, // retired
    [ranked[2]]: { status: 200, ms: 300 }, // works: should win
    [ranked[3]]: { status: 200, ms: 50 }, // works and is faster, but ranked lower
    [ranked[4]]: { status: 500, ms: 50 },
    [ranked[5]]: { status: 200, ms: 50 },
  });
  try {
    const t0 = Date.now();
    const r = await connectBest("groq", "https://x.test/v1", "k");
    const took = Date.now() - t0;
    assert.ok(!("error" in r), JSON.stringify(r));
    if ("error" in r) return;
    assert.equal(r.model, ranked[2]);
    assert.ok(took < 700, `took ${took} ms: the tests should run at the same time, not one after another (~900 ms)`);
    assert.equal(r.fallbacks[0], ranked[3], "a model that answered comes first among fallbacks");
    assert.ok(!r.fallbacks.includes(ranked[0]) && !r.fallbacks.includes(ranked[1]) && !r.fallbacks.includes(ranked[4]), "failed models are left out");
  } finally {
    p.restore();
  }
});

test("a model the person chose is tried first", async () => {
  const pick = ranked[4];
  const p = provider(Object.fromEntries(NAMES.map((n) => [n, { status: 200, ms: 20 }])));
  try {
    const r = await connectBest("groq", "https://x.test/v1", "k", pick);
    assert.ok(!("error" in r) && r.model === pick);
  } finally {
    p.restore();
  }
});

test("a rejected key stops at once", async () => {
  const p = provider(Object.fromEntries(NAMES.map((n) => [n, { status: 401, ms: 20 }])));
  try {
    const r = await connectBest("groq", "https://x.test/v1", "bad");
    assert.ok("error" in r && r.status === 401);
  } finally {
    p.restore();
  }
});

test("when nothing answers, says so with the last reason", async () => {
  const p = provider(Object.fromEntries(NAMES.map((n) => [n, { status: 429, ms: 20 }])));
  try {
    const r = await connectBest("groq", "https://x.test/v1", "k");
    assert.ok("error" in r && /none of the 6 models/.test(r.error), JSON.stringify(r));
  } finally {
    p.restore();
  }
});
