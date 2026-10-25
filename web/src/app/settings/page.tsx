// @reviewed 2026-10-25
"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { ConfirmButton, PageHeader } from "@/components/ui";
import type { ProviderId } from "@/lib/types";

const PROVIDERS: Record<ProviderId, { label: string; base: string; models: string[]; search: boolean }> = {
  anthropic: { label: "Anthropic (Claude)", base: "https://api.anthropic.com", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"], search: true },
  openai: { label: "OpenAI", base: "https://api.openai.com/v1", models: [], search: false },
  openrouter: { label: "OpenRouter", base: "https://openrouter.ai/api/v1", models: [], search: false },
  gemini: { label: "Google Gemini (OpenAI-compatible)", base: "https://generativelanguage.googleapis.com/v1beta/openai", models: [], search: false },
  custom: { label: "Custom OpenAI-compatible", base: "", models: [], search: false },
};

export default function SettingsPage() {
  const { state, saveSettings, resetDemo } = useStore();
  const s = state.settings;
  const [provider, setProvider] = useState<ProviderId>(s.provider);
  const [model, setModel] = useState(s.model);
  const [baseUrl, setBaseUrl] = useState(s.baseUrl);
  const [key, setKey] = useState("");
  const [web, setWeb] = useState(s.webResearch);
  const [msg, setMsg] = useState("");
  const P = PROVIDERS[provider];

  return (
    <>
      <PageHeader title="Settings" sub="Bring your own AI key. Pathwise uses it to research and build your roadmaps." />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <form
          className="card space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            saveSettings({ provider, model, baseUrl, webResearch: web && P.search, ...(key ? { apiKeyLast4: key.slice(-4) } : {}) });
            setKey("");
            setMsg("Saved. (Demo: only the last 4 characters are kept in this browser; the key itself is not stored.)");
          }}
        >
          <div>
            <label className="label" htmlFor="prov">Provider</label>
            <select
              id="prov"
              className="input"
              value={provider}
              onChange={(e) => {
                const p = e.target.value as ProviderId;
                setProvider(p);
                setModel(PROVIDERS[p].models[0] ?? "");
              }}
            >
              {Object.entries(PROVIDERS).map(([id, p]) => (
                <option key={id} value={id}>{p.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="model">Model</label>
            <input id="model" className="input font-mono" list="models" value={model} onChange={(e) => setModel(e.target.value)} placeholder="model id" />
            <datalist id="models">
              {P.models.map((m) => <option key={m} value={m} />)}
            </datalist>
          </div>

          {provider !== "anthropic" && (
            <div>
              <label className="label" htmlFor="base">Base URL</label>
              <input id="base" className="input font-mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={P.base || "https://…/v1"} />
            </div>
          )}

          <div>
            <label className="label" htmlFor="key">API key</label>
            <input id="key" type="password" autoComplete="off" className="input font-mono" value={key} onChange={(e) => setKey(e.target.value)} placeholder={s.apiKeyLast4 ? `•••• •••• ${s.apiKeyLast4} (saved)` : provider === "anthropic" ? "sk-ant-…" : "sk-…"} />
          </div>

          <label className={`flex items-start gap-3 text-sm ${P.search ? "" : "opacity-50"}`}>
            <input type="checkbox" className="mt-1 accent-[var(--color-accent)]" checked={web && P.search} disabled={!P.search} onChange={(e) => setWeb(e.target.checked)} />
            <span>
              Live web research (Reddit, YouTube, docs)
              <span className="block text-xs text-muted">
                {P.search ? "Uses Claude's server-side web search tool to find and cross-verify sources." : "Not available for this provider — resources will be marked “unverified”."}
              </span>
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-primary">Save</button>
            <button type="button" className="btn" onClick={() => setMsg("Connection test runs server-side once the backend (Phase 2) is connected.")}>
              Test connection
            </button>
            {msg && <span className="text-xs text-muted">{msg}</span>}
          </div>
        </form>

        <aside className="space-y-4">
          <div className="card text-sm text-muted">
            <div className="label">How your key is handled</div>
            <ul className="list-disc space-y-1.5 pl-4">
              <li>Encrypted at rest in Supabase Vault.</li>
              <li>Decrypted only inside the generation worker; never sent back to the browser.</li>
              <li>You pay your provider directly; token usage is shown per roadmap.</li>
            </ul>
          </div>
          <div className="card">
            <div className="label">Demo data</div>
            <p className="mb-3 text-sm text-muted">Restore the sample goals, routines and events.</p>
            <ConfirmButton onConfirm={resetDemo}>Reset demo data</ConfirmButton>
          </div>
        </aside>
      </div>
    </>
  );
}
