#!/usr/bin/env bun
// hooks/capture-prompt.ts — Forward UserPromptSubmit hook events to the daemon
// and deliver any queued advisor injects to the agent via additionalContext.
//
// The daemon queues inject events arriving over its cloud WebSocket (see
// injectQueues in src/daemon/daemon.ts); the /events response for a
// UserPromptSubmit hook drains that queue as pendingInjects, which we surface
// to Claude Code as hookSpecificOutput. Always exits 0; never blocks.

const POLARIS_PORT = process.env.POLARIS_PORT ?? "4322";
const POLARIS_URL = `http://127.0.0.1:${POLARIS_PORT}/events`;

try {
  const input = JSON.parse(await Bun.stdin.text());

  const res = await fetch(POLARIS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).catch(() => null);

  if (res && res.ok) {
    const body = (await res.json().catch(() => null)) as {
      pendingInjects?: Array<{ from: string; content: string; timestamp: string }>;
    } | null;
    const items = body?.pendingInjects;
    if (Array.isArray(items) && items.length > 0) {
      const formatted =
        "Teammate guidance injected into this session:\n" +
        items.map((i) => `- [${i.from}] ${i.content}`).join("\n");
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: formatted,
          },
        })
      );
    }
  }
} catch {
  // Always exit 0 to avoid blocking the coding agent
}

process.exit(0);
