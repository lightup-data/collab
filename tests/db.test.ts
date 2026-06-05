import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  createDb,
  createProject,
  getProject,
  createSession,
  getSession,
  setDriver,
  clearDriver,
  pushEvent,
  getProjectEvents,
  getSessionEvents,
  getEventsSince,
} from "../src/service/db";
import type { CollabEvent } from "../src/types";

let db: Database;

beforeEach(() => {
  db = createDb();
});

function makeEvent(overrides: Partial<CollabEvent> = {}): CollabEvent {
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
      prompt: "hello",
    },
    ...overrides,
  };
}

describe("projects", () => {
  test("create and retrieve a project", () => {
    const project = createProject(db, "pj");
    expect(project.name).toBe("pj");
    expect(project.created_at).toBeDefined();

    const retrieved = getProject(db, "pj");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe("pj");
  });

  test("duplicate project name throws", () => {
    createProject(db, "pj");
    expect(() => createProject(db, "pj")).toThrow();
  });

  test("get nonexistent project returns null", () => {
    expect(getProject(db, "nope")).toBeNull();
  });
});

describe("sessions", () => {
  beforeEach(() => {
    createProject(db, "pj");
  });

  test("create and retrieve a session", () => {
    const session = createSession(db, "pj", "fxm", "user:manu");
    expect(session.name).toBe("fxm");
    expect(session.project).toBe("pj");
    expect(session.driver).toBe("user:manu");

    const retrieved = getSession(db, "pj", "fxm");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.driver).toBe("user:manu");
  });

  test("create session with null driver", () => {
    const session = createSession(db, "pj", "open-session", null);
    expect(session.driver).toBeNull();
  });

  test("duplicate session name in same project throws", () => {
    createSession(db, "pj", "fxm", "user:manu");
    expect(() => createSession(db, "pj", "fxm", "user:krishna")).toThrow();
  });

  test("same session name in different projects is fine", () => {
    createProject(db, "pj2");
    createSession(db, "pj", "fxm", "user:manu");
    const s2 = createSession(db, "pj2", "fxm", "user:krishna");
    expect(s2.driver).toBe("user:krishna");
  });

  test("get nonexistent session returns null", () => {
    expect(getSession(db, "pj", "nope")).toBeNull();
  });

  test("set driver", () => {
    createSession(db, "pj", "fxm", "user:manu");
    setDriver(db, "pj", "fxm", "user:krishna");
    const session = getSession(db, "pj", "fxm");
    expect(session!.driver).toBe("user:krishna");
  });

  test("clear driver", () => {
    createSession(db, "pj", "fxm", "user:manu");
    clearDriver(db, "pj", "fxm");
    const session = getSession(db, "pj", "fxm");
    expect(session!.driver).toBeNull();
  });
});

describe("events", () => {
  beforeEach(() => {
    createProject(db, "pj");
    createSession(db, "pj", "fxm", "user:manu");
    createSession(db, "pj", "fxk", "user:krishna");
  });

  test("push and retrieve events by project", () => {
    const e1 = makeEvent({ session: "fxm", timestamp: "2026-06-05T10:00:00.000Z" });
    const e2 = makeEvent({ session: "fxk", sender: "user:krishna", timestamp: "2026-06-05T10:01:00.000Z" });
    pushEvent(db, e1);
    pushEvent(db, e2);

    const events = getProjectEvents(db, "pj");
    expect(events).toHaveLength(2);
    expect(events[0].session).toBe("fxm");
    expect(events[1].session).toBe("fxk");
  });

  test("retrieve events by session", () => {
    pushEvent(db, makeEvent({ session: "fxm" }));
    pushEvent(db, makeEvent({ session: "fxk", sender: "user:krishna" }));
    pushEvent(db, makeEvent({ session: "fxm" }));

    const fxmEvents = getSessionEvents(db, "pj", "fxm");
    expect(fxmEvents).toHaveLength(2);

    const fxkEvents = getSessionEvents(db, "pj", "fxk");
    expect(fxkEvents).toHaveLength(1);
  });

  test("events are ordered by timestamp", () => {
    pushEvent(db, makeEvent({ session: "fxm", timestamp: "2026-06-05T10:02:00.000Z" }));
    pushEvent(db, makeEvent({ session: "fxm", timestamp: "2026-06-05T10:00:00.000Z" }));
    pushEvent(db, makeEvent({ session: "fxm", timestamp: "2026-06-05T10:01:00.000Z" }));

    const events = getSessionEvents(db, "pj", "fxm");
    expect(events[0].timestamp).toBe("2026-06-05T10:00:00.000Z");
    expect(events[1].timestamp).toBe("2026-06-05T10:01:00.000Z");
    expect(events[2].timestamp).toBe("2026-06-05T10:02:00.000Z");
  });

  test("getEventsSince filters by timestamp", () => {
    pushEvent(db, makeEvent({ timestamp: "2026-06-05T10:00:00.000Z" }));
    pushEvent(db, makeEvent({ timestamp: "2026-06-05T10:01:00.000Z" }));
    pushEvent(db, makeEvent({ timestamp: "2026-06-05T10:02:00.000Z" }));

    const events = getEventsSince(db, "pj", "2026-06-05T10:00:30.000Z");
    expect(events).toHaveLength(2);
    expect(events[0].timestamp).toBe("2026-06-05T10:01:00.000Z");
  });

  test("payload round-trips through JSON", () => {
    const event = makeEvent({
      source: "inject",
      payload: {
        type: "inject" as const,
        content: "Use RS256",
        sender: "user:krishna" as const,
        target: "fxm",
      },
    });
    pushEvent(db, event);

    const events = getSessionEvents(db, "pj", "fxm");
    expect(events[0].payload).toEqual(event.payload);
  });

  test("empty project returns empty array", () => {
    expect(getProjectEvents(db, "pj")).toEqual([]);
  });
});
