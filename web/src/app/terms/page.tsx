import type { Metadata } from "next";
import { LegalPage } from "@/components/Legal";

export const metadata: Metadata = { title: "Terms · Where MyLife" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="23 November 2026">
      <p>By using Where MyLife you agree to these terms.</p>

      <h2>The service</h2>
      <p>
        Where MyLife is a personal tool for planning learning goals and study time. It is provided as it is, without any guarantee that it will always be available or
        free of mistakes. Plans and suggestions, including those written by an AI model, are aids, not advice you must follow.
      </p>

      <h2>Your account and content</h2>
      <ul>
        <li>You are responsible for what you enter and for keeping your Google account secure.</li>
        <li>Your content stays yours. The app uses it only to run the features you use, as described in the <a className="underline" href="/privacy">privacy policy</a>.</li>
        <li>If you connect outside services (an AI model provider, Notion, Google Calendar), their own terms also apply, and any costs they charge are yours.</li>
      </ul>

      <h2>Fair use</h2>
      <p>Do not use the app to break the law, to attack or overload it, or to get at other people&rsquo;s data.</p>

      <h2>Changes and ending</h2>
      <p>
        These terms may change; the date above shows the latest version. You can stop using the app at any time and disconnect any service in Settings. Access may be
        ended for misuse.
      </p>
    </LegalPage>
  );
}
