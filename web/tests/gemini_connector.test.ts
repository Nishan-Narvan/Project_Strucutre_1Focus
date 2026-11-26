import { test } from "node:test";
import assert from "node:assert/strict";
import { detectActor } from "../src/lib/server/connector";

test("detectActor identifies Gemini from query param, headers, and user-agent", () => {
  // Query param detection
  const reqWithGeminiParam = new Request("https://example.com/api/connector/abc/mcp?client=gemini");
  assert.equal(detectActor(reqWithGeminiParam), "gemini");

  const reqWithGoogleParam = new Request("https://example.com/api/connector/abc/mcp?client=google");
  assert.equal(detectActor(reqWithGoogleParam), "gemini");

  const reqWithClaudeParam = new Request("https://example.com/api/connector/abc/mcp?client=claude");
  assert.equal(detectActor(reqWithClaudeParam), "claude");

  // Header detection
  const reqWithGeminiHeader = new Request("https://example.com/api/connector/abc/mcp", {
    headers: { "x-client": "gemini" },
  });
  assert.equal(detectActor(reqWithGeminiHeader), "gemini");

  // User-Agent detection
  const reqWithGeminiUA = new Request("https://example.com/api/connector/abc/mcp", {
    headers: { "user-agent": "Google-Gemini/1.0 (ConnectedApps)" },
  });
  assert.equal(detectActor(reqWithGeminiUA), "gemini");

  const reqWithClaudeUA = new Request("https://example.com/api/connector/abc/mcp", {
    headers: { "user-agent": "Claude-Custom-Connector/1.0 (Anthropic)" },
  });
  assert.equal(detectActor(reqWithClaudeUA), "claude");

  // Default fallback
  const reqDefault = new Request("https://example.com/api/connector/abc/mcp");
  assert.equal(detectActor(reqDefault), "claude");
});
