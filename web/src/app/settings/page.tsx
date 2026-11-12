"use client";

import { PageHeader } from "@/components/ui";
import { BehaviourSettings, DashboardSettings, DataSettings } from "@/components/SettingsPanels";
import { ModelForm } from "@/components/ModelForm";
import { McpConnections } from "@/components/McpConnections";
import { ClaudeConnector } from "@/components/ClaudeConnector";
import { AppearanceSettings } from "@/components/Appearance";

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
          <AppearanceSettings />
          <BehaviourSettings />
          <DashboardSettings />
          <ClaudeConnector />
          <McpConnections />
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
