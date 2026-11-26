"use client";

import { PageHeader } from "@/components/ui";
import { BehaviourSettings, DashboardSettings, DataSettings } from "@/components/SettingsPanels";
import { ModelForm } from "@/components/ModelForm";
import { McpConnections } from "@/components/McpConnections";
import { AiConnectors } from "@/components/AiConnectors";
import { AppearanceSettings } from "@/components/Appearance";
import { MemoryFileButtons } from "@/components/Editors";
import { NotionSettings } from "@/components/NotionView";
import { CalendarSettings } from "@/components/CalendarView";
import { GoogleSyncSettings } from "@/components/GoogleSync";

export default function SettingsPage() {

  return (
    <>
      <PageHeader title="Settings" sub="Your model, how the app looks, and the outside services it may use." />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section className="card" aria-labelledby="model-title">
            <h2 id="model-title" className="mb-4 text-base font-medium">Model and API key</h2>
            <ModelForm />
          </section>
          <NotionSettings />
          <CalendarSettings />
          <GoogleSyncSettings />
          <AiConnectors />
          <section className="card space-y-3" aria-label="Memory file">
            <h2 className="text-base font-medium">Memory file</h2>
            <p className="text-sm text-muted">Everything about all your goals in one document: roadmaps, what is done and left, daily history, changes, materials, KPIs and your constraints. Give it to any model to carry on.</p>
            <MemoryFileButtons label="All goals" />
          </section>
          <AppearanceSettings />
          <details className="card p-0">
            <summary className="cursor-pointer p-5 text-base font-medium">Advanced: limits, Goals page sections, outside services</summary>
            <div className="space-y-6 border-t border-line p-5">
              <BehaviourSettings />
              <DashboardSettings />
              <McpConnections />
            </div>
          </details>
        </div>

        <aside className="space-y-4">
          <div className="card text-sm text-muted">
            <div className="label">Where your key and data go</div>
            <ul className="list-disc space-y-1.5 pl-4">
              <li>Your goals and history are saved to your account, so they are the same on every device.</li>
              <li>Keys and tokens are encrypted before they are saved, and never sent back to the browser.</li>
              <li>When you ask the assistant something, your goals, progress, routines and notes are sent to the model provider you chose as context.</li>
              <li>You pay the provider directly, or nothing on a free tier.</li>
            </ul>
          </div>
          <DataSettings />
        </aside>
      </div>
    </>
  );
}
