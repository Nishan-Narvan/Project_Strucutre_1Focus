"use client";

import { useStore } from "@/lib/store";
import { ConfirmButton, PageHeader } from "@/components/ui";
import { ModelForm } from "@/components/ModelForm";
import { McpConnections } from "@/components/McpConnections";
import { ClaudeConnector } from "@/components/ClaudeConnector";

export default function SettingsPage() {
  const { resetDemo } = useStore();

  return (
    <>
      <PageHeader title="Settings" sub="Give the assistant a model to think with, and the outside services it may use." />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section className="card" aria-labelledby="model-title">
            <h2 id="model-title" className="mb-4 text-base font-medium">Model and API key</h2>
            <ModelForm />
          </section>
          <ClaudeConnector />
          <McpConnections />
        </div>

        <aside className="space-y-4">
          <div className="card text-sm text-muted">
            <div className="label">Where your key and data go</div>
            <ul className="list-disc space-y-1.5 pl-4">
              <li>Keys and tokens are kept in this browser only.</li>
              <li>Each question passes the key through this app&apos;s server to the provider you chose. It is not stored or logged there.</li>
              <li>When you ask the assistant something, your goals, progress, routines and notes are sent to that provider as context.</li>
              <li>You pay the provider directly, or nothing on a free tier.</li>
            </ul>
          </div>
          <div className="card">
            <div className="label">Demo data</div>
            <p className="mb-3 text-sm text-muted">Restore the sample goals, routines and events. Clears the assistant&apos;s memory and conversation; keeps your key and connections.</p>
            <ConfirmButton onConfirm={resetDemo}>Reset demo data</ConfirmButton>
          </div>
        </aside>
      </div>
    </>
  );
}
