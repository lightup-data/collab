import { describe, expect, test } from "bun:test";
import {
  ParticipantId,
  HookPayload,
  InjectMessage,
  ReplyMessage,
  PolarisEvent,
  Project,
  Session,
} from "../src/types";

describe("ParticipantId", () => {
  test("accepts valid user IDs", () => {
    expect(ParticipantId.parse("user:manu")).toBe("user:manu");
    expect(ParticipantId.parse("user:krishna")).toBe("user:krishna");
    expect(ParticipantId.parse("user:a1")).toBe("user:a1");
    expect(ParticipantId.parse("user:some-user.name_1")).toBe("user:some-user.name_1");
  });

  test("accepts valid agent IDs", () => {
    expect(ParticipantId.parse("agent:test-writer")).toBe("agent:test-writer");
    expect(ParticipantId.parse("agent:security-reviewer")).toBe("agent:security-reviewer");
    expect(ParticipantId.parse("agent:dq_checker.v2")).toBe("agent:dq_checker.v2");
  });

  test("rejects invalid IDs", () => {
    expect(() => ParticipantId.parse("manu")).toThrow();
    expect(() => ParticipantId.parse("")).toThrow();
    expect(() => ParticipantId.parse("foo:bar")).toThrow();
    expect(() => ParticipantId.parse("user:")).toThrow();
    expect(() => ParticipantId.parse("user:CAPS")).toThrow();
    expect(() => ParticipantId.parse("agent:has spaces")).toThrow();
  });
});

describe("HookPayload", () => {
  test("parses UserPromptSubmit", () => {
    const result = HookPayload.parse({
      hook_event_name: "UserPromptSubmit",
      session_id: "abc123",
      prompt: "hello world",
    });
    expect(result.hook_event_name).toBe("UserPromptSubmit");
    expect(result.prompt).toBe("hello world");
  });

  test("parses Stop", () => {
    const result = HookPayload.parse({
      hook_event_name: "Stop",
      session_id: "abc123",
      stop_response: "Here is my response",
    });
    expect(result.hook_event_name).toBe("Stop");
    expect(result.stop_response).toBe("Here is my response");
  });

  test("parses PreToolUse", () => {
    const result = HookPayload.parse({
      hook_event_name: "PreToolUse",
      session_id: "abc123",
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
    });
    expect(result.hook_event_name).toBe("PreToolUse");
    expect(result.tool_name).toBe("Bash");
  });

  test("parses PostToolUse", () => {
    const result = HookPayload.parse({
      hook_event_name: "PostToolUse",
      session_id: "abc123",
      tool_name: "Read",
      tool_input: { file_path: "/tmp/test.txt" },
      tool_result: { content: [{ type: "text", text: "file contents" }] },
    });
    expect(result.hook_event_name).toBe("PostToolUse");
    expect(result.tool_name).toBe("Read");
  });

  test("rejects unknown hook event names", () => {
    expect(() =>
      HookPayload.parse({
        hook_event_name: "Unknown",
        session_id: "abc123",
      })
    ).toThrow();
  });

  test("rejects missing required fields", () => {
    expect(() =>
      HookPayload.parse({
        hook_event_name: "UserPromptSubmit",
        session_id: "abc123",
        // missing prompt
      })
    ).toThrow();
  });
});

describe("InjectMessage", () => {
  test("parses valid inject message", () => {
    const result = InjectMessage.parse({
      type: "inject",
      content: "Use RS256 for the auth tokens",
      sender: "user:krishna",
      target: "fxm",
    });
    expect(result.content).toBe("Use RS256 for the auth tokens");
    expect(result.target).toBe("fxm");
  });

  test("rejects missing target", () => {
    expect(() =>
      InjectMessage.parse({
        type: "inject",
        content: "some advice",
        sender: "user:krishna",
        target: "",
      })
    ).toThrow();
  });

  test("rejects invalid sender", () => {
    expect(() =>
      InjectMessage.parse({
        type: "inject",
        content: "advice",
        sender: "krishna",
        target: "fxm",
      })
    ).toThrow();
  });
});

describe("ReplyMessage", () => {
  test("parses valid reply", () => {
    const result = ReplyMessage.parse({
      type: "reply",
      content: "Done, switched to RS256",
      sender: "agent:test-writer",
    });
    expect(result.content).toBe("Done, switched to RS256");
    expect(result.in_reply_to).toBeUndefined();
  });

  test("parses reply with in_reply_to", () => {
    const result = ReplyMessage.parse({
      type: "reply",
      content: "Acknowledged",
      sender: "user:manu",
      in_reply_to: "evt-123",
    });
    expect(result.in_reply_to).toBe("evt-123");
  });
});

describe("PolarisEvent", () => {
  test("parses a full hook event envelope", () => {
    const result = PolarisEvent.parse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      project: "pj",
      session: "fxm",
      timestamp: "2026-06-05T10:00:00.000Z",
      source: "hook",
      sender: "user:manu",
      payload: {
        hook_event_name: "UserPromptSubmit",
        session_id: "abc",
        prompt: "Let's build auth",
      },
    });
    expect(result.source).toBe("hook");
    expect(result.project).toBe("pj");
  });

  test("parses an inject event envelope", () => {
    const result = PolarisEvent.parse({
      id: "550e8400-e29b-41d4-a716-446655440001",
      project: "pj",
      session: "fxm",
      timestamp: "2026-06-05T10:01:00.000Z",
      source: "inject",
      sender: "user:krishna",
      payload: {
        type: "inject",
        content: "Use JWT RS256",
        sender: "user:krishna",
        target: "fxm",
      },
    });
    expect(result.source).toBe("inject");
  });

  test("rejects invalid source", () => {
    expect(() =>
      PolarisEvent.parse({
        id: "550e8400-e29b-41d4-a716-446655440002",
        project: "pj",
        session: "fxm",
        timestamp: "2026-06-05T10:00:00.000Z",
        source: "unknown",
        sender: "user:manu",
        payload: {},
      })
    ).toThrow();
  });
});

describe("Project", () => {
  test("parses valid project", () => {
    const result = Project.parse({ name: "pj", created_at: "2026-06-05T10:00:00.000Z" });
    expect(result.name).toBe("pj");
  });

  test("rejects empty name", () => {
    expect(() => Project.parse({ name: "", created_at: "2026-06-05T10:00:00.000Z" })).toThrow();
  });
});

describe("Session", () => {
  test("parses valid session with driver", () => {
    const result = Session.parse({
      name: "fxm",
      project: "pj",
      driver: "user:manu",
      created_at: "2026-06-05T10:00:00.000Z",
    });
    expect(result.driver).toBe("user:manu");
  });

  test("parses session with null driver (open for handoff)", () => {
    const result = Session.parse({
      name: "fxm",
      project: "pj",
      driver: null,
      created_at: "2026-06-05T10:00:00.000Z",
    });
    expect(result.driver).toBeNull();
  });
});
