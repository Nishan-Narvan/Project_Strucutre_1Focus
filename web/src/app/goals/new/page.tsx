"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { addDays, fmtDate, today, uid, WEEK_ORDER, WEEKDAYS } from "@/lib/date";
import { budget, buildSessions } from "@/lib/schedule";
import { committedHours, RULES } from "@/lib/rules";
import { demoRoadmapFor } from "@/lib/demo";
import type { ChatMessage, ContextAttachment, Goal } from "@/lib/types";

const TINTS = ["#f5f5f5", "#b8b8b8", "#8a8a8a"];
const CURRENT = ["Complete beginner", "Some exposure", "Intermediate", "Advanced"];
const TARGET = ["Working knowledge", "Job-ready", "Advanced", "Expert"];

const STAGES = [
  { label: "Researching Reddit, YouTube, docs and courses", ms: 3000 },
  { label: "Building phases from first principles, starting at your level", ms: 2600 },
  { label: "Cross-checking order, level, time and links", ms: 2400 },
  { label: "Breaking phases into daily tasks around your routines", ms: 1200 },
];

/** Downscale an image to a small JPEG data URL so previews stay light in storage. */
async function preview(file: File): Promise<string | undefined> {
  if (!file.type.startsWith("image/")) return undefined;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const s = Math.min(1, 240 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * s);
    c.height = Math.round(img.height * s);
    c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.7);
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const kb = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export default function NewGoal() {
  const router = useRouter();
  const { state, addGoal } = useStore();
  const t = today();
  const [f, setF] = useState({
    title: "",
    outcome: "",
    currentLevel: CURRENT[1],
    known: "",
    targetLevel: TARGET[1],
    startDate: t,
    deadline: addDays(t, 56),
    hoursPerDay: 1,
    days: [0, 1, 2, 3, 4, 5, 6],
    prefStart: "19:00",
    prefs: "",
  });
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: "What do you want to learn, and why now? Attach anything that helps: a syllabus, a job post, notes, screenshots of where you're stuck." },
  ]);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<ContextAttachment[]>([]);
  const [stage, setStage] = useState<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => chatEnd.current?.scrollIntoView({ block: "nearest" }), [messages]);

  const B = budget(f);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const atLimit = state.goals.length >= RULES.maxActiveGoals;
  const hoursAfter = committedHours(state.goals) + f.hoursPerDay;
  const overHours = hoursAfter > RULES.maxDailyHours;
  const valid = f.title.trim().length > 2 && f.days.length > 0 && f.deadline > f.startDate && !atLimit && !overHours;
  const allFiles = messages.flatMap((m) => m.attachments ?? []);

  // P0: scripted brainstorm partner. P2 sends the transcript + attachments to the model.
  function reply(text: string, attached: ContextAttachment[], userTurns: number): string {
    const ack = attached.length ? `I'll use ${attached.map((a) => a.name).join(" and ")} as context. ` : "";
    if (userTurns === 1) {
      if (!f.title) set("title", text.replace(/\s+/g, " ").slice(0, 70));
      return `${ack}Good. To start you at the right level: what can you already do here, and what would "done" look like for you?`;
    }
    if (userTurns === 2) {
      set("known", text.slice(0, 240));
      return `${ack}That puts you just past the basics, so the first phase builds on what you know rather than repeating it. When do you need this by, and how many hours can you give it on a normal day? I've assumed ${f.hoursPerDay} h a day until ${fmtDate(f.deadline)}.`;
    }
    const h = text.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hour)/i);
    const w = text.match(/(\d+)\s*(week|month)/i);
    if (h) set("hoursPerDay", Math.min(RULES.maxDailyHours, Number(h[1])));
    if (w) set("deadline", addDays(f.startDate, Number(w[1]) * (w[2].toLowerCase().startsWith("m") ? 30 : 7)));
    if (h || w) return `${ack}Updated the brief on the right. Check it, then build the roadmap, or keep adding context.`;
    return `${ack}Noted, I've added that to the brief. Anything about how you like to learn (videos, books, projects)? Otherwise you're ready to build the roadmap.`;
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() && files.length === 0) return;
    const userTurns = messages.filter((m) => m.role === "user").length + 1;
    const user: ChatMessage = { role: "user", text: draft.trim(), attachments: files.length ? files : undefined };
    const assistant: ChatMessage = { role: "assistant", text: reply(draft.trim(), files, userTurns) };
    if (userTurns >= 4 && draft.trim()) set("prefs", (f.prefs ? f.prefs + "; " : "") + draft.trim().slice(0, 120));
    setMessages((m) => [...m, user, assistant]);
    setDraft("");
    setFiles([]);
  }

  async function attach(list: FileList | null) {
    if (!list) return;
    const added = await Promise.all(
      [...list].slice(0, 6).map(async (file) => ({ id: uid(), name: file.name, type: file.type || "file", size: file.size, preview: await preview(file) })),
    );
    setFiles((x) => [...x, ...added].slice(0, 6));
  }

  function generate() {
    setStage(0);
    let at = 0;
    STAGES.forEach((s, i) => {
      timers.current.push(setTimeout(() => setStage(i), at));
      at += s.ms;
    });
    timers.current.push(
      setTimeout(() => {
        const goal: Goal = {
          ...f,
          title: f.title.trim(),
          id: uid(),
          color: TINTS[state.goals.length % TINTS.length],
          createdAt: t,
          roadmap: demoRoadmapFor(f.title.trim()),
          sessions: [],
          brainstorm: messages,
        };
        goal.sessions = buildSessions(goal, goal.startDate < t ? t : goal.startDate);
        addGoal(goal);
        router.push(`/goals/${goal.id}`);
      }, at),
    );
  }

  if (atLimit && stage === null)
    return (
      <div className="max-w-xl">
        <h1 className="font-serif text-5xl leading-tight">You already have {RULES.maxActiveGoals} goals running</h1>
        <p className="mt-4 text-[15px] text-ink/80">
          Pathwise keeps you to {RULES.maxActiveGoals} at a time so each one actually gets finished. Complete or delete one to start another.
        </p>
        <Link href="/goals" className="btn btn-primary mt-6">See your goals</Link>
      </div>
    );

  return (
    <>
      <header className="mb-8">
        <h1 className="font-serif text-5xl leading-[1.05] tracking-tight">Start a new goal</h1>
        <p className="mt-3 max-w-2xl text-[15px] text-ink/80">
          Talk it through first. Pathwise asks what you know, reads what you attach, then builds a roadmap of phases and a daily plan.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <section aria-label="Brainstorm" className="flex h-[640px] flex-col rounded-[10px] border border-line bg-panel">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "ml-auto max-w-[85%]" : "max-w-[85%]"}>
                <div className={`rounded-[14px] px-4 py-2.5 text-[15px] leading-relaxed ${m.role === "user" ? "bg-ink text-black" : "bg-panel-2 text-ink"}`}>
                  {m.text || <span className="opacity-60">Attached context</span>}
                </div>
                {m.attachments && (
                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    {m.attachments.map((a) => <Attachment key={a.id} a={a} />)}
                  </div>
                )}
              </div>
            ))}
            <div ref={chatEnd} />
          </div>

          <form onSubmit={send} className="border-t border-line p-3">
            {files.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {files.map((a) => (
                  <Attachment key={a.id} a={a} onRemove={() => setFiles((x) => x.filter((y) => y.id !== a.id))} />
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <label className="btn cursor-pointer" title="Attach photos or files">
                Attach
                <input type="file" multiple accept="image/*,.pdf,.txt,.md,.doc,.docx" className="sr-only" onChange={(e) => { attach(e.target.files); e.target.value = ""; }} />
              </label>
              <textarea
                rows={1}
                className="input min-h-[38px] resize-none"
                placeholder="I want to get interview-ready in DSA…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) send(e);
                }}
                aria-label="Message"
              />
              <button className="btn btn-primary">Send</button>
            </div>
            <p className="mt-2 px-1 text-xs text-faint">Images, PDFs and notes up to 6 per message. Demo mode replies with a scripted partner.</p>
          </form>
        </section>

        <section aria-label="Goal brief" className="card space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-medium">The brief</h2>
            <span className="text-xs text-muted">{allFiles.length ? `${allFiles.length} attachment${allFiles.length > 1 ? "s" : ""} as context` : "Fills in as you talk"}</span>
          </div>
          <div>
            <label className="label" htmlFor="title">Goal</label>
            <input id="title" className="input" placeholder="What you want to learn" value={f.title} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="outcome">Done looks like</label>
            <input id="outcome" className="input" placeholder="e.g. Pass coding rounds at product companies" value={f.outcome} onChange={(e) => set("outcome", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="cur">Starting from</label>
              <select id="cur" className="input" value={f.currentLevel} onChange={(e) => set("currentLevel", e.target.value)}>
                {CURRENT.map((x) => <option key={x}>{x}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="tgt">Aiming for</label>
              <select id="tgt" className="input" value={f.targetLevel} onChange={(e) => set("targetLevel", e.target.value)}>
                {TARGET.map((x) => <option key={x}>{x}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="known">Already know</label>
            <textarea id="known" rows={2} className="input resize-none" value={f.known} onChange={(e) => set("known", e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label" htmlFor="start">Start</label>
              <input id="start" type="date" className="input" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="deadline">Deadline</label>
              <input id="deadline" type="date" className="input" value={f.deadline} onChange={(e) => set("deadline", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="pref">Daily at</label>
              <input id="pref" type="time" className="input" value={f.prefStart} onChange={(e) => set("prefStart", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-[96px_1fr] items-end gap-3">
            <div>
              <label className="label" htmlFor="hpd">Hours a day</label>
              <input id="hpd" type="number" min={0.25} max={RULES.maxDailyHours} step={0.25} className="input" value={f.hoursPerDay} onChange={(e) => set("hoursPerDay", Number(e.target.value) || 0.25)} />
            </div>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Study days">
              {WEEK_ORDER.map((d) => {
                const on = f.days.includes(d);
                return (
                  <button key={d} type="button" aria-pressed={on} onClick={() => set("days", on ? f.days.filter((x) => x !== d) : [...f.days, d])}
                    className={`rounded-full border px-2.5 py-1.5 text-xs ${on ? "border-ink text-ink" : "border-line text-faint"}`}>
                    {WEEKDAYS[d].slice(0, 2)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg bg-panel-2 px-4 py-3">
            <div className="font-serif text-3xl">{Math.round(B.minutes / 60)} hours</div>
            <p className="text-sm text-muted">over {B.days} study days. The plan uses about 85% of it and keeps the rest as buffer.</p>
            {overHours && (
              <p className="mt-2 text-sm text-bad">
                That would take you to {hoursAfter} h a day across all goals, over the {RULES.maxDailyHours} h limit. Lower the hours or pause another goal.
              </p>
            )}
          </div>

          {stage === null ? (
            <button className="btn btn-primary w-full py-2.5 text-[15px]" disabled={!valid} onClick={generate}>
              Build my roadmap
            </button>
          ) : (
            <ol className="space-y-3 pt-1" aria-live="polite">
              {STAGES.map((s, i) => (
                <li key={s.label} className="flex items-center gap-3 text-sm">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${i < stage ? "bg-ink" : i === stage ? "crystal-dot glow-pulse" : "bg-line"}`} />
                  <span className={i < stage ? "text-muted" : i === stage ? "crystal-text" : "text-faint"}>{s.label}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="text-xs text-faint">
            {state.goals.length} of {RULES.maxActiveGoals} goals in use. Roadmaps can be changed for {RULES.editWindowDays} days, then only added to.
          </p>
        </section>
      </div>
    </>
  );
}

function Attachment({ a, onRemove }: { a: ContextAttachment; onRemove?: () => void }) {
  return (
    <span className="flex items-center gap-2 rounded-lg border border-line bg-black p-1.5 pr-2.5 text-xs">
      {a.preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={a.preview} alt={a.name} className="h-9 w-9 rounded object-cover" />
      ) : (
        <span className="grid h-9 w-9 place-items-center rounded bg-panel-2 text-[10px] text-muted">{a.name.split(".").pop()?.slice(0, 4)}</span>
      )}
      <span className="max-w-32 truncate text-ink">{a.name}</span>
      <span className="text-faint">{kb(a.size)}</span>
      {onRemove && (
        <button type="button" className="text-muted hover:text-bad" onClick={onRemove} aria-label={`Remove ${a.name}`}>
          Remove
        </button>
      )}
    </span>
  );
}
