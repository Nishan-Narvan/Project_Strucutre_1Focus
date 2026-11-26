"use client";

import { AiConnectors } from "./AiConnectors";

/** Backwards-compatible wrapper around AiConnectors */
export function ClaudeConnector() {
  return <AiConnectors initialProvider="gemini" />;
}
