"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { chatOnce, connectModel, explain } from "@/lib/agent/models";
import { agentReady, PROVIDER_ORDER, PROVIDERS, rankModels } from "@/lib/providers";
import type { ProviderId } from "@/lib/types";

/**
 * Pick a provider, paste a key, press Connect. Connecting checks the key, reads the
 * provider's models and sends a tiny test message to find one that really answers.
 * "Connected" is only shown after a real reply came back.
 * Used on the Settings page and inside the assistant window.
 */
export function ModelForm({ compact = false }: { compact?: boolean }) {
  const { state, saveSettings } = useStore();
  const s = state.settings;
  const [provider, setProvider] = useState<ProviderId>(s.provider);
  const [key, setKey] = useState(s.apiKey);
  const [baseUrl, setBaseUrl] = useState(s.baseUrl);
  const [show, setShow] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const P = PROVIDERS[provider];
  const access = { provider, apiKey: key.trim(), baseUrl: baseUrl.trim() };
  const connected = agentReady(s) && s.provider === provider && s.apiKey === key.trim();
  const id = compact ? "bot" : "set";

  async function connect() {
    if (!key.trim()) return setMsg({ text: "Paste your API key first.", bad: true });
    setMsg(null);
    setBusy("Checking the key");
    const r = await connectModel(access, s.provider === provider ? s.model : "", setBusy);
    setBusy("");
    if ("error" in r) return setMsg({ text: r.error, bad: true });
    setModels(rankModels(provider, r.models));
    saveSettings({ ...access, model: r.model, fallbacks: r.fallbacks });
    setMsg({ text: `Connected. ${r.model} answered a test message.` });
  }

  /** A model picked by hand is tested before it replaces the working one. */
  async function choose(model: string) {
    if (!model || model === s.model) return;
    setMsg(null);
    setBusy(`Testing ${model}`);
    const r = await chatOnce(access, model, [{ role: "user", content: "Reply with the single word: ok" }], null);
    setBusy("");
    if (!r.ok) return setMsg({ text: `${model} did not answer, so ${s.model} stays. ${explain(r.status, r.error)}`, bad: true });
    saveSettings({ model, fallbacks: [s.model, ...(s.fallbacks ?? [])].filter((m) => m && m !== model).slice(0, 4) });
    setMsg({ text: `Now using ${model}.` });
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="label" htmlFor={`${id}-prov`}>Provider</label>
        <select
          id={`${id}-prov`}
          className="input"
          value={provider}
          onChange={(e) => {
            const p = e.target.value as ProviderId;
            setProvider(p);
            setModels([]);
            setKey(p === s.provider ? s.apiKey : "");
            setMsg(null);
          }}
        >
          {PROVIDER_ORDER.map((p) => (
            <option key={p} value={p}>{PROVIDERS[p].label}</option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-muted">
          {P.note}{" "}
          {P.keyUrl && (
            <a href={P.keyUrl} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-2">Get a key from {P.label}</a>
          )}
        </p>
      </div>

      {provider === "custom" && (
        <div>
          <label className="label" htmlFor={`${id}-base`}>Base URL</label>
          <input id={`${id}-base`} className="input font-mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…/v1" />
        </div>
      )}

      <div>
        <label className="label" htmlFor={`${id}-key`}>API key</label>
        <div className="flex gap-2">
          <input
            id={`${id}-key`}
            type={show ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            className="input font-mono"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && connect()}
            placeholder={P.keyHint}
          />
          <button type="button" className="btn shrink-0" onClick={() => setShow((x) => !x)}>{show ? "Hide" : "Show"}</button>
        </div>
      </div>

      {connected && (
        <div>
          <label className="label" htmlFor={`${id}-model`}>Model</label>
          {models.length ? (
            <select id={`${id}-model`} className="input font-mono" value={s.model} disabled={Boolean(busy)} onChange={(e) => choose(e.target.value)}>
              {!models.includes(s.model) && <option value={s.model}>{s.model}</option>}
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <p className="text-sm text-ink">
              <span className="font-mono">{s.model}</span>
              <span className="text-muted">. Press the button below to see the other models.</span>
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" onClick={connect} disabled={Boolean(busy)}>
          {busy ? `${busy}…` : connected ? "Test again and list models" : "Connect"}
        </button>
        {connected && !busy && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              saveSettings({ apiKey: "", model: "", fallbacks: [] });
              setKey("");
              setModels([]);
              setMsg({ text: "Key removed from this browser." });
            }}
          >
            Remove key
          </button>
        )}
      </div>
      {msg && <p className={`text-sm break-words ${msg.bad ? "text-bad" : "text-muted"}`} role="status">{msg.text}</p>}
    </div>
  );
}
