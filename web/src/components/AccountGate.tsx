"use client";

import { useEffect, useState } from "react";
import { clearCache, useStore } from "@/lib/store";
import { Logo } from "@/components/Shell";

/** Shown instead of the app until the person is signed in and their data is set up. */
export function AccountGate() {
  const { status, legacy, setup, user, notice } = useStore();
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get("auth_error");
    if (e) setAuthError(e);
  }, []);

  async function start(mode: "import" | "demo" | "empty") {
    setBusy(mode);
    setError("");
    try {
      await setup(mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy("");
    }
  }

  const frame = (children: React.ReactNode) => (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-2.5">
          <Logo className="h-7 w-7 text-ink" />
          <span className="font-serif text-2xl leading-none">Where MyLife</span>
        </div>
        {children}
      </div>
    </div>
  );

  if (status === "loading") return frame(<p className="text-muted">Loading…</p>);

  if (status === "unconfigured")
    return frame(
      <p className="text-sm text-muted">
        Accounts are not set up on this server yet. It needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and WML_ENCRYPTION_KEY (see web/.env.example).
      </p>,
    );

  if (status === "error")
    return frame(
      <>
        <p className="text-ink">Your data could not be loaded.</p>
        <p className="mt-1 text-sm text-muted">{notice ?? "Check your connection."}</p>
        <button type="button" className="btn btn-primary mt-5" onClick={() => window.location.reload()}>Try again</button>
      </>,
    );

  if (status === "signedOut")
    return frame(
      <>
        <h1 className="font-serif text-4xl leading-tight tracking-tight">Sign in to see where your goals stand</h1>
        <p className="mt-3 text-sm text-muted">Your goals, progress and saved keys are kept with your account, so they are the same on every device.</p>
        <a href="/auth/login" className="btn btn-primary mt-6 py-2.5 text-[15px]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
            <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
            <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
            <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
            <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
          </svg>
          Sign in with Google
        </a>
        {authError && <p className="mt-4 text-sm text-bad" role="alert">{authError}</p>}
      </>,
    );

  if (status === "setup")
    return frame(
      <>
        <h1 className="font-serif text-4xl leading-tight tracking-tight">Welcome{user?.email ? `, ${user.email.split("@")[0]}` : ""}</h1>
        <p className="mt-3 text-sm text-muted">Your account is new. Choose what to start with. You only do this once.</p>
        <div className="mt-6 space-y-3">
          {legacy && (
            <button type="button" disabled={Boolean(busy)} onClick={() => start("import")} className="w-full rounded-[12px] border border-crystal/60 p-4 text-left transition hover:bg-panel-2">
              <span className="block font-medium text-ink">{busy === "import" ? "Importing…" : "Bring in the data from this browser"}</span>
              <span className="mt-0.5 block text-sm text-muted">
                {legacy.goals.length} goal{legacy.goals.length === 1 ? "" : "s"}, {legacy.routines.length} routines, {legacy.memories?.length ?? 0} memories
                {legacy.settings?.apiKey ? ", and your saved API key (stored encrypted)" : ""}.
              </span>
            </button>
          )}
          <button type="button" disabled={Boolean(busy)} onClick={() => start("demo")} className="w-full rounded-[12px] border border-line p-4 text-left transition hover:bg-panel-2">
            <span className="block font-medium text-ink">{busy === "demo" ? "Setting up…" : "Start with the three sample goals"}</span>
            <span className="mt-0.5 block text-sm text-muted">Explore with example data, then delete it when you are ready.</span>
          </button>
          <button type="button" disabled={Boolean(busy)} onClick={() => start("empty")} className="w-full rounded-[12px] border border-line p-4 text-left transition hover:bg-panel-2">
            <span className="block font-medium text-ink">{busy === "empty" ? "Setting up…" : "Start empty"}</span>
            <span className="mt-0.5 block text-sm text-muted">No goals yet; create your first one.</span>
          </button>
        </div>
        {error && <p className="mt-4 text-sm text-bad" role="alert">{error}</p>}
      </>,
    );

  return null;
}

/** Signed-in email, save status, and sign out, for the sidebar. */
export function AccountBox() {
  const { user, saving, undo } = useStore();
  const [undone, setUndone] = useState("");
  if (!user) return null;
  return (
    <div className="text-xs text-faint">
      <p className="truncate text-muted" title={user.email}>{user.email}</p>
      <p className="mt-0.5">{saving ? "Saving…" : "All changes saved"}</p>
      <div className="mt-2 flex flex-wrap gap-1">
      <button
        type="button"
        className="btn btn-quiet btn-sm -ml-2.5"
        onClick={async () => {
          try {
            const what = await undo();
            setUndone(`Undid: ${what.replace(/_/g, " ")}`);
          } catch (e) {
            setUndone(e instanceof Error ? e.message : "Could not undo.");
          }
          setTimeout(() => setUndone(""), 5000);
        }}
      >
        Undo
      </button>
      <form action="/auth/logout" method="post" onSubmit={clearCache}>
        <button className="btn btn-quiet btn-sm">Sign out</button>
      </form>
      </div>
      {undone && <p className="mt-1 text-muted" role="status">{undone}</p>}
    </div>
  );
}

/** A refused change or a lost connection, shown at the bottom of the screen. */
export function Notice() {
  const { notice, dismissNotice, status } = useStore();
  if (!notice || status !== "ready") return null;
  return (
    <div role="alert" className="fixed bottom-5 left-1/2 z-50 flex w-[min(92vw,520px)] -translate-x-1/2 items-start gap-3 rounded-[12px] border border-bad/40 bg-panel px-4 py-3 text-sm text-ink shadow-2xl shadow-black/30">
      <span className="flex-1">{notice}</span>
      <button type="button" className="text-muted hover:text-ink" onClick={dismissNotice} aria-label="Dismiss">Close</button>
    </div>
  );
}
