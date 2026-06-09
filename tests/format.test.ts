import { describe, expect, test, beforeEach } from "bun:test";
import { formatEventForSlack, setPromptStyle } from "../src/slack/format";
import type { PolarisEvent } from "../src/types";

function makeEvent(overrides: Partial<PolarisEvent> = {}): PolarisEvent {
  return {
    id: crypto.randomUUID(),
    project: "pj",
    session: "fxm",
    timestamp: new Date().toISOString(),
    source: "hook",
    sender: "user:manu",
    payload: {
      hook_event_name: "UserPromptSubmit",
      session_id: "s1",
      prompt: "build auth middleware",
    },
    ...overrides,
  };
}

describe("formatEventForSlack", () => {
  beforeEach(() => {
    setPromptStyle("color"); // default
  });

  test("formats UserPromptSubmit with color style", () => {
    const result = formatEventForSlack(makeEvent());
    expect(result).not.toBeNull();
    expect(result!.text).toContain("user:manu");
    expect(result!.text).toContain("fxm");
    expect(result!.text).toContain("build auth middleware");
    expect(result!.attachments).toHaveLength(1);
    expect(result!.attachments![0].color).toBe("#4263eb");
  });

  test("formats UserPromptSubmit with emoji style", () => {
    setPromptStyle("emoji");
    const result = formatEventForSlack(makeEvent());
    expect(result).not.toBeNull();
    expect(result!.text).toContain("💬");
    expect(result!.blocks).toHaveLength(2);
  });

  test("formats UserPromptSubmit with header style", () => {
    setPromptStyle("header");
    const result = formatEventForSlack(makeEvent());
    expect(result).not.toBeNull();
    expect(result!.blocks![0].type).toBe("header");
  });

  test("formats Stop", () => {
    const result = formatEventForSlack(makeEvent({
      payload: {
        hook_event_name: "Stop",
        session_id: "s1",
        stop_response: "Created src/middleware/auth.ts",
      },
    }));
    expect(result).not.toBeNull();
    expect(result!.text).toContain("agent");
    expect(result!.text).toContain("Created src/middleware/auth.ts");
    expect(result!.blocks).toHaveLength(2);
  });

  test("skips PreToolUse", () => {
    const result = formatEventForSlack(makeEvent({
      payload: {
        hook_event_name: "PreToolUse",
        session_id: "s1",
        tool_name: "Bash",
        tool_input: { command: "ls" },
      },
    }));
    expect(result).toBeNull();
  });

  test("skips PostToolUse", () => {
    const result = formatEventForSlack(makeEvent({
      payload: {
        hook_event_name: "PostToolUse",
        session_id: "s1",
        tool_name: "Read",
        tool_input: { file_path: "/tmp/test" },
        tool_result: { content: [{ type: "text", text: "file" }] },
      },
    }));
    expect(result).toBeNull();
  });

  test("formats inject message with green color", () => {
    const result = formatEventForSlack(makeEvent({
      source: "inject",
      sender: "user:krishna",
      payload: {
        type: "inject" as const,
        content: "Use RS256 for the JWT",
        sender: "user:krishna",
        target: "fxm",
      },
    }));
    expect(result).not.toBeNull();
    expect(result!.text).toContain("user:krishna");
    expect(result!.text).toContain("fxm");
    expect(result!.attachments).toHaveLength(1);
    expect(result!.attachments![0].color).toBe("#16a34a");
  });

  test("formats reply message", () => {
    const result = formatEventForSlack(makeEvent({
      source: "reply",
      sender: "user:manu",
      payload: {
        type: "reply" as const,
        content: "Done, switched to RS256",
        sender: "user:manu",
      },
    }));
    expect(result).not.toBeNull();
    expect(result!.text).toContain("replied");
    expect(result!.text).toContain("Done, switched to RS256");
  });

  test("truncates long messages", () => {
    const longText = "x".repeat(3000);
    const result = formatEventForSlack(makeEvent({
      payload: {
        hook_event_name: "Stop",
        session_id: "s1",
        stop_response: longText,
      },
    }));
    expect(result).not.toBeNull();
    const bodyText = (result!.blocks![1].text as { text: string }).text;
    expect(bodyText.length).toBeLessThan(2100);
    expect(bodyText).toContain("...");
  });

  test("converts markdown bold to mrkdwn", () => {
    const result = formatEventForSlack(makeEvent({
      payload: {
        hook_event_name: "Stop",
        session_id: "s1",
        stop_response: "This is **bold** text",
      },
    }));
    expect(result).not.toBeNull();
    const bodyText = (result!.blocks![1].text as { text: string }).text;
    expect(bodyText).toContain("*bold*");
    expect(bodyText).not.toContain("**bold**");
  });
});
