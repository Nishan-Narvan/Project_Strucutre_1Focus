import type { Metadata } from "next";
import { LegalPage } from "@/components/Legal";

export const metadata: Metadata = { title: "Privacy · Where MyLife" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="23 November 2026">
      <p>
        Where MyLife helps you plan learning goals and schedule study sessions. This page says what the app stores, what it sends to other services, and what it does with
        your Google data.
      </p>

      <h2>What the app stores</h2>
      <ul>
        <li>Your Google account&rsquo;s email address and user id, from signing in, so your data is yours on every device.</li>
        <li>What you enter: goals, roadmaps, tasks, study sessions, notes, routines, events, KPIs and settings.</li>
        <li>Keys and connection tokens you add (model API key, Notion secret, calendar address, Google Calendar login). These are encrypted before they are saved and are never sent back to your browser.</li>
      </ul>
      <p>Your data is stored in a database hosted by Supabase. The app is hosted on Vercel.</p>

      <h2>Google Calendar</h2>
      <p>
        If you connect Google Calendar, the app asks only for permission to create its own calendars and manage the events in them (the
        <code className="mx-1 text-sm">calendar.app.created</code> scope). It makes one calendar called &ldquo;Where MyLife&rdquo; and writes your planned study sessions
        and goal deadlines into it, with reminders, so Google can notify you. It cannot see, change or delete any of your other calendars or events.
      </p>
      <p>
        Where MyLife&rsquo;s use and transfer of information received from Google APIs adheres to the{" "}
        <a className="underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>, including the
        Limited Use requirements. Google data is used only to provide this feature to you. It is not sold, not used for advertising, not used to train AI models, and not
        read by people except when you ask for help with a problem.
      </p>

      <h2>Other services you choose to connect</h2>
      <ul>
        <li>AI model: when you ask the assistant something, your goals, progress, routines and notes are sent as context to the model provider you picked, under that provider&rsquo;s terms.</li>
        <li>Notion and calendar feeds: read only when you connect them, to show their content next to your plan.</li>
        <li>Claude connector: if you create a connector link, Claude can read and change your data through it, as you direct.</li>
      </ul>

      <h2>What the app does not do</h2>
      <ul>
        <li>No advertising, no selling or sharing of your data, no tracking across other sites.</li>
      </ul>

      <h2>Removing your data</h2>
      <ul>
        <li>Disconnect Google Calendar in Settings at any time; this withdraws the app&rsquo;s access in your Google account. You can also remove it at myaccount.google.com/permissions.</li>
        <li>To delete your account and all its data, contact the developer through the support email shown on Google&rsquo;s sign-in screen for this app.</li>
      </ul>
    </LegalPage>
  );
}
