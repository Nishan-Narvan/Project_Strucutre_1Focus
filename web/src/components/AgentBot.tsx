"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "@/lib/store";
import { today, uid } from "@/lib/date";
import { askAgent, type Approval, type Verdict } from "@/lib/agent/run";
import { agentReady, PROVIDERS } from "@/lib/providers";
import { ModelForm } from "@/components/ModelForm";
import type { AgentTurn, MemoryKind } from "@/lib/types";

const STARTERS = [
  "Where am I right now across all my goals?",
  "Which goal needs my attention most, and what exactly should I do?",
  "Should any of my roadmaps or deadlines change?",
  "Do I have room for a new goal?",
];

const KINDS: MemoryKind[] = ["fact", "preference", "commitment", "pattern", "lesson"];

type Mood = "asleep" | "idle" | "thinking";

/** The assistant's face: a small robot. Eyes light crystal while it is working, and close when it has no model. */
export function BotFace({ mood = "idle", className = "" }: { mood?: Mood; className?: string }) {
  const lit = mood === "thinking";
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <line x1="24" y1="10" x2="24" y2="5.5" stroke="#f4f4f4" strokeWidth="2" strokeLinecap="round" />
      <circle cx="24" cy="4.5" r="2.4" fill={mood === "asleep" ? "#4a4a4a" : "#bfe9ff"} className={lit ? "glow-pulse" : undefined} style={mood === "asleep" ? undefined : { filter: "drop-shadow(0 0 3px #bfe9ff)" }} />
      <rect x="3" y="19" width="4" height="9" rx="2" fill="#f4f4f4" />
      <rect x="41" y="19" width="4" height="9" rx="2" fill="#f4f4f4" />
      <rect x="7" y="10" width="34" height="27" rx="10" fill="#161616" stroke="#f4f4f4" strokeWidth="2" />
      {mood === "asleep" ? (
        <>
          <path d="M14 22.5 q3.5 3 7 0" stroke="#f4f4f4" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M27 22.5 q3.5 3 7 0" stroke="#f4f4f4" strokeWidth="2" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <g className="bot-blink" fill={lit ? "#bfe9ff" : "#f4f4f4"} style={lit ? { filter: "drop-shadow(0 0 3px #bfe9ff)" } : undefined}>
          <circle cx="17.5" cy="22" r="3.4" />
          <circle cx="30.5" cy="22" r="3.4" />
        </g>
      )}
      <path d="M19.5 29.5 q4.5 3.4 9 0" stroke="#f4f4f4" strokeWidth="2" fill="none" strokeLinecap="round" />
      <rect x="16" y="39.5" width="16" height="4.5" rx="2.2" fill="#f4f4f4" />
    </svg>
  );
}

function IconBtn({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition hover:bg-panel-2 hover:text-ink ${active ? "bg-panel-2 text-ink" : "text-muted"}`}
    >
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

/**
 * The assistant, present on every page: a robot in the corner that opens a chat window.
 * The conversation keeps running if the window is closed.
 */
export function AgentBot() {
  const { state, saveChat, newChat, assistant } = useStore();
  const abort = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "memory">("chat");
  const [big, setBig] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [pending, setPending] = useState<(Approval & { resolve: (v: Verdict) => void }) | null>(null);
  const live = useRef(state);
  live.current = state;
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const ready = agentReady(state.settings);
  const services = (state.settings.mcp ?? []).filter((s) => s.enabled && s.tools.length);
  const mood: Mood = !ready ? "asleep" : busy ? "thinking" : "idle";

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [state.chat, steps, busy, pending, open, view]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  /** `base` is the conversation to continue from; it defaults to the one on screen. */
  async function ask(question: string, base?: AgentTurn[]) {
    const q = question.trim();
    if (!q || busy || !ready) return;
    const history = base ?? live.current.chat;
    const withUser: AgentTurn[] = [...history, { id: uid(), role: "user", text: q, at: new Date().toISOString() }];
    saveChat(withUser);
    setDraft("");
    setBusy(true);
    setSteps([]);
    setView("chat");
    const seen: string[] = [];
    const steps = () => (seen.length ? [...seen] : undefined);
    const stopper = new AbortController();
    abort.current = stopper;
    let reply: AgentTurn;
    try {
      const a = await askAgent({
        getState: () => live.current,
        history,
        question: q,
        t: today(),
        actions: { addMemory: assistant.addMemory, deleteMemory: assistant.deleteMemory, reschedule: assistant.reschedule, addTask: assistant.addTask, saveSettings: assistant.saveSettings },
        onStep: (label) => {
          seen.push(label);
          setSteps([...seen]);
        },
        // Nothing is changed until the person answers; the window opens so the question is seen
        onApprove: (a) =>
          new Promise<Verdict>((resolve) => {
            setOpen(true);
            setView("chat");
            setPending({ ...a, resolve });
          }),
        signal: stopper.signal,
      });
      reply = { id: uid(), role: "assistant", text: a.text, thinking: a.thinking, check: a.check, steps: steps() };
    } catch (e) {
      reply = stopper.signal.aborted
        ? { id: uid(), role: "assistant", text: "Stopped.", steps: steps() }
        : { id: uid(), role: "assistant", text: e instanceof Error ? e.message : "Something went wrong.", steps: steps(), error: true };
    }
    saveChat([...withUser, { ...reply, at: new Date().toISOString() }]);
    setPending(null);
    setBusy(false);
    setSteps([]);
  }

  /** Ask the last question again, replacing the failed attempt. */
  function retry() {
    const chat = live.current.chat;
    const i = chat.map((c) => c.role).lastIndexOf("user");
    if (i !== -1) ask(chat[i].text, chat.slice(0, i));
  }

  function stop() {
    abort.current?.abort();
    pending?.resolve("skip");
  }

  const decide = (v: Verdict) => {
    pending?.resolve(v);
    setPending(null);
  };

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label="Assistant"
          className={`fixed inset-x-3 top-3 bottom-24 z-40 flex flex-col overflow-hidden rounded-[18px] border border-line bg-black shadow-2xl shadow-black sm:top-auto sm:right-5 sm:left-auto ${
            big ? "sm:h-[calc(100dvh-7.5rem)] sm:w-[min(720px,calc(100vw-2.5rem))]" : "sm:h-[min(640px,calc(100dvh-7.5rem))] sm:w-[400px]"
          }`}
        >
          <header className="flex items-center gap-3 border-b border-line px-4 py-3">
            <BotFace mood={mood} className="h-9 w-9 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] leading-tight font-medium">Assistant</p>
              <p className="truncate text-xs text-muted">
                {ready ? `${PROVIDERS[state.settings.provider].label}, ${state.settings.model}` : "Asleep until it has a model"}
              </p>
            </div>
            <IconBtn label={view === "memory" ? "Back to the conversation" : "What it remembers about you"} active={view === "memory"} onClick={() => setView(view === "memory" ? "chat" : "memory")}>
              <path d="M5 3.5h10v13l-5-3.2-5 3.2z" />
            </IconBtn>
            {state.chat.length > 0 && !busy && (
              <IconBtn label="Start a new conversation (this one stays searchable)" onClick={() => { newChat(); setView("chat"); }}>
                <path d="M10 4v12M4 10h12" />
              </IconBtn>
            )}
            <span className="hidden sm:block">
              <IconBtn label={big ? "Make the window smaller" : "Make the window bigger"} onClick={() => setBig((x) => !x)}>
                {big ? <path d="M8 3v5H3M12 17v-5h5" /> : <path d="M3 8V3h5M17 12v5h-5" />}
              </IconBtn>
            </span>
            <IconBtn label="Close" onClick={() => setOpen(false)}>
              <path d="M5 5l10 10M15 5L5 15" />
            </IconBtn>
          </header>

          {view === "memory" ? (
            <MemoryView />
          ) : (
            <>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                {!ready ? (
                  <div>
                    <p className="font-serif text-2xl leading-tight">I need a model to think with</p>
                    <p className="mt-2 mb-5 text-sm text-muted">Paste your own API key. Groq and Google Gemini both have a free tier, and the key stays in this browser.</p>
                    <ModelForm compact />
                  </div>
                ) : state.chat.length === 0 ? (
                  <div>
                    <p className="font-serif text-2xl leading-tight">Ask me about where you are</p>
                    <p className="mt-2 text-sm text-muted">I read your goals, progress, routines and notes before I answer. I can also re-plan a goal or add a task if you ask.</p>
                    <div className="mt-4 flex flex-col items-start gap-2">
                      {STARTERS.map((q) => (
                        <button key={q} type="button" className="rounded-[12px] border border-line px-3.5 py-2 text-left text-sm text-ink transition hover:border-faint hover:bg-panel-2" onClick={() => ask(q)}>
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  state.chat.map((m, i) => <Turn key={m.id} turn={m} onRetry={!busy && m.error && i === state.chat.length - 1 ? retry : undefined} onSettings={() => setOpen(false)} />)
                )}

                {busy && (
                  <div className="space-y-1.5 text-sm" aria-live="polite">
                    {steps.map((s, i) => (
                      <p key={i} className="text-muted">{s}</p>
                    ))}
                    {!pending && (
                      <p className="flex items-center gap-2.5">
                        <span className="crystal-dot glow-pulse h-2 w-2 rounded-full" />
                        <span className="crystal-text">{steps.length ? "Thinking it through" : "Reading your data"}</span>
                      </p>
                    )}
                  </div>
                )}

                {pending && (
                  <div className="crystal-ring rounded-[14px] p-4" role="alertdialog" aria-label="The assistant wants to make a change">
                    <p className="text-sm text-muted">The assistant wants to</p>
                    <p className="mt-0.5 font-medium text-ink">{pending.title}</p>
                    <p className="mt-1.5 max-h-40 overflow-y-auto text-sm break-words whitespace-pre-wrap text-muted">{pending.detail}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" className="btn btn-primary" onClick={() => decide("allow")}>Allow</button>
                      <button type="button" className="btn" onClick={() => decide("all")}>Allow all for this question</button>
                      <button type="button" className="btn" onClick={() => decide("skip")}>Skip</button>
                    </div>
                  </div>
                )}
                <div ref={end} />
              </div>

              {ready && (
                <form
                  className="border-t border-line p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    ask(draft);
                  }}
                >
                  <div className="flex items-end gap-2">
                    <textarea
                      ref={input}
                      rows={1}
                      className="input min-h-[38px] resize-none"
                      placeholder="Ask about your progress, a goal, or the app"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          ask(draft);
                        }
                      }}
                      aria-label="Message"
                    />
                    {busy ? (
                      <button type="button" className="btn" onClick={stop}>Stop</button>
                    ) : (
                      <button className="btn btn-primary" disabled={!draft.trim()}>Ask</button>
                    )}
                  </div>
                  <p className="mt-2 px-1 text-xs text-faint">
                    {services.length ? `Can use ${services.map((s) => s.name).join(", ")}. ` : "No outside services connected. "}
                    <Link href="/settings" className="text-muted underline underline-offset-2 hover:text-ink" onClick={() => setOpen(false)}>
                      {services.length ? "Manage connections" : "Connect Google Calendar or Notion"}
                    </Link>
                  </p>
                </form>
              )}
            </>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        aria-label={open ? "Close the assistant" : "Open the assistant"}
        aria-expanded={open}
        title={open ? "Close the assistant" : "Ask your assistant"}
        className={`fixed right-5 bottom-5 z-40 grid h-16 w-16 place-items-center rounded-full border bg-panel transition hover:scale-105 ${open || busy ? "crystal-ring border-crystal" : "border-line hover:border-faint"}`}
      >
        <BotFace mood={mood} className="h-11 w-11" />
        {pending && !open && <span className="crystal-dot glow-pulse absolute top-0.5 right-0.5 h-3.5 w-3.5 rounded-full" />}
      </button>
    </>
  );
}

function Turn({ turn: m, onRetry, onSettings }: { turn: AgentTurn; onRetry?: () => void; onSettings: () => void }) {
  if (m.role === "user")
    return <div className="ml-auto w-fit max-w-[88%] rounded-[14px] bg-ink px-3.5 py-2 text-[15px] leading-relaxed break-words whitespace-pre-wrap text-black">{m.text}</div>;
  const figures = m.check ? m.check.found + m.check.missing.length : 0;
  return (
    <div className="max-w-[94%]">
      {m.steps && (
        <ul className="mb-2 space-y-0.5 text-sm text-muted">
          {m.steps.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      )}
      <div className={`rounded-[14px] px-3.5 py-2.5 text-[15px] leading-relaxed break-words ${m.error ? "border border-bad/40 text-bad" : "bg-panel-2 text-ink"}`}>
        <Rich text={m.text} />
      </div>

      {m.error && (
        <div className="mt-2 flex flex-wrap gap-2">
          {onRetry && <button type="button" className="btn" onClick={onRetry}>Try again</button>}
          <Link href="/settings" className="btn" onClick={onSettings}>Open Settings</Link>
        </div>
      )}

      {m.check && (
        <p className={`mt-1.5 px-1 text-xs ${m.check.missing.length ? "text-bad" : "text-muted"}`}>
          {m.check.missing.length === 0
            ? `Checked: ${figures === 1 ? "the figure" : `all ${figures} figures`} in this answer ${figures === 1 ? "is" : "are"} in your data.`
            : `Checked: ${m.check.found} of ${figures} figures are in your data. Not found there: ${m.check.missing.join(", ")}. That is either the assistant's own arithmetic or a mistake, so ask it to show the working.`}
        </p>
      )}

      {m.thinking && (
        <details className="mt-1.5 px-1 text-xs text-muted">
          <summary className="cursor-pointer select-none hover:text-ink">How it got there</summary>
          <p className="mt-1.5 border-l border-line pl-3 leading-relaxed whitespace-pre-wrap">{m.thinking}</p>
        </details>
      )}
    </div>
  );
}

/** Bold and code spans inside a line of model output. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
    : part.startsWith("`") && part.endsWith("`") && part.length > 2 ? <code key={i} className="rounded bg-black px-1 py-0.5 text-[13px]">{part.slice(1, -1)}</code>
    : part,
  );
}

/** Just enough formatting for a model's answer: paragraphs, dash lists and bold. */
function Rich({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={blocks.length} className="list-disc space-y-1 pl-5">
        {list.map((item, i) => <li key={i}>{inline(item)}</li>)}
      </ul>,
    );
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flush();
    if (line) blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ""))}</p>);
  }
  flush();
  return <div className="space-y-2.5">{blocks}</div>;
}

/** What the assistant keeps between conversations. The person can read, add and delete all of it. */
function MemoryView() {
  const { state, addMemory, deleteMemory } = useStore();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<MemoryKind>("fact");
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <p className="font-serif text-2xl leading-tight">What I remember about you</p>
      <p className="mt-2 text-sm text-muted">I save what I learn and read it before every answer. Delete anything that is wrong.</p>

      {state.memories.length === 0 ? (
        <p className="mt-4 text-sm text-faint">Nothing yet. It fills in as we talk.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {state.memories.map((m) => (
            <li key={m.id} className="py-2.5">
              <p className="text-sm text-ink">{m.text}</p>
              <p className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
                <span>{m.kind}, {m.source === "user" ? "added by you" : "learned"} {m.createdAt}</span>
                <button type="button" className="hover:text-bad" onClick={() => deleteMemory(m.id)} aria-label={`Forget: ${m.text}`}>Forget</button>
              </p>
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-5 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (addMemory(kind, text, "user")) setText("");
        }}
      >
        <label className="label" htmlFor="mem">Tell me something to remember</label>
        <input id="mem" className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="I can't study on Sundays" />
        <div className="flex gap-2">
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)} aria-label="Kind of memory">
            {KINDS.map((k) => <option key={k}>{k}</option>)}
          </select>
          <button className="btn shrink-0" disabled={!text.trim()}>Remember</button>
        </div>
      </form>
    </div>
  );
}
