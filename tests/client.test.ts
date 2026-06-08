import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { startServer } from "../src/service/server";
import type { Sql } from "../src/service/db";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://polaris:polaris@localhost:5432/polaris";

let serviceUrl: string;
let sql: Sql;
let stopService: () => Promise<void>;
let localServer: ReturnType<typeof Bun.serve> | null = null;

beforeAll(async () => {
  const s = await startServer({ port: 0, databaseUrl: DATABASE_URL });
  sql = s.sql;
  stopService = s.stop;
  serviceUrl = `http://localhost:${s.server.port}`;
});

afterAll(async () => {
  localServer?.stop(true);
  await stopService();
});

beforeEach(async () => {
  localServer?.stop(true);
  localServer = null;
  await sql`DROP TABLE IF EXISTS events`;
  await sql`DROP TABLE IF EXISTS sessions`;
  await sql`DROP TABLE IF EXISTS projects`;
  await sql`CREATE TABLE IF NOT EXISTS projects (name TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS sessions (name TEXT NOT NULL, project TEXT NOT NULL REFERENCES projects(name), driver TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (project, name))`;
  await sql`CREATE TABLE IF NOT EXISTS events (id UUID PRIMARY KEY, project TEXT NOT NULL, session TEXT NOT NULL, timestamp TIMESTAMPTZ NOT NULL, source TEXT NOT NULL, sender TEXT NOT NULL, payload JSONB NOT NULL)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_events_project ON events(project, timestamp)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_events_session ON events(project, session, timestamp)`;
});

// Test the hook relay HTTP server independently (without MCP stdio)
function startHookRelay(project: string, session: string, user: string, port: number) {
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/events") {
        try {
          const body = await req.json();
          const res = await fetch(`${serviceUrl}/projects/${project}/sessions/${session}/events`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sender: user, payload: body }),
          });
          if (!res.ok) {
            const err = await res.text();
            return new Response(err, { status: res.status });
          }
          return new Response("ok", { status: 200 });
        } catch {
          return new Response("bad request", { status: 400 });
        }
      }
      if (req.method === "GET" && url.pathname === "/status") {
        return Response.json({ ok: true, project, session, user });
      }
      return new Response("not found", { status: 404 });
    },
  });
}

describe("hook relay", () => {
  test("relays a hook event to the cloud service", async () => {
    // Set up project and session on the cloud service
    await fetch(`${serviceUrl}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "pj" }),
    });
    await fetch(`${serviceUrl}/projects/pj/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "fxm", driver: "user:manu" }),
    });

    // Start local hook relay
    localServer = startHookRelay("pj", "fxm", "user:manu", 0);
    const localUrl = `http://127.0.0.1:${localServer.port}`;

    // Simulate a hook event (like capture.sh would send)
    const hookPayload = {
      hook_event_name: "UserPromptSubmit",
      session_id: "s1",
      prompt: "build the auth middleware",
    };
    const res = await fetch(`${localUrl}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hookPayload),
    });
    expect(res.status).toBe(200);

    // Verify event arrived at the cloud service
    const messagesRes = await fetch(`${serviceUrl}/projects/pj/sessions/fxm/messages`);
    const messages = await messagesRes.json();
    expect(messages).toHaveLength(1);
    expect(messages[0].payload.prompt).toBe("build the auth middleware");
    expect(messages[0].sender).toBe("user:manu");
  });

  test("returns 400 on invalid payload", async () => {
    await fetch(`${serviceUrl}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "pj" }),
    });
    await fetch(`${serviceUrl}/projects/pj/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "fxm", driver: "user:manu" }),
    });

    localServer = startHookRelay("pj", "fxm", "user:manu", 0);
    const localUrl = `http://127.0.0.1:${localServer.port}`;

    const res = await fetch(`${localUrl}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bad: "data" }),
    });
    expect(res.status).toBe(400);
  });

  test("local status endpoint works", async () => {
    localServer = startHookRelay("pj", "fxm", "user:manu", 0);
    const res = await fetch(`http://127.0.0.1:${localServer.port}/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.project).toBe("pj");
  });
});

describe("WebSocket integration", () => {
  test("inject events from cloud reach session WS", async () => {
    await fetch(`${serviceUrl}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "pj" }),
    });
    await fetch(`${serviceUrl}/projects/pj/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "fxm", driver: "user:manu" }),
    });

    // Connect a WS to the session (simulating what the client does)
    const wsUrl = serviceUrl.replace("http", "ws");
    const ws = new WebSocket(`${wsUrl}/projects/pj/sessions/fxm/ws`);
    const received: unknown[] = [];

    await new Promise<void>((resolve) => { ws.onopen = () => resolve(); });
    ws.onmessage = (e) => received.push(JSON.parse(e.data as string));

    // Inject an advisor message
    await fetch(`${serviceUrl}/projects/pj/sessions/fxm/inject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Use RS256", sender: "user:krishna" }),
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(received).toHaveLength(1);
    expect((received[0] as { source: string }).source).toBe("inject");
    expect((received[0] as { payload: { content: string } }).payload.content).toBe("Use RS256");
    ws.close();
  });
});

describe("capture.sh", () => {
  test("script relays stdin to local server", async () => {
    await fetch(`${serviceUrl}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "pj" }),
    });
    await fetch(`${serviceUrl}/projects/pj/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "fxm", driver: "user:manu" }),
    });

    localServer = startHookRelay("pj", "fxm", "user:manu", 0);

    const hookPayload = JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "s1",
      prompt: "test from capture.sh",
    });

    // Run the actual capture.sh script
    const proc = Bun.spawn(["sh", "hooks/capture.sh"], {
      stdin: "pipe",
      env: { ...process.env, POLARIS_PORT: String(localServer.port) },
    });
    proc.stdin.write(hookPayload);
    proc.stdin.end();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);

    // Give a moment for the relay
    await new Promise((r) => setTimeout(r, 200));

    // Verify event arrived
    const messagesRes = await fetch(`${serviceUrl}/projects/pj/sessions/fxm/messages`);
    const messages = await messagesRes.json();
    expect(messages).toHaveLength(1);
    expect(messages[0].payload.prompt).toBe("test from capture.sh");
  });

  test("script exits 0 even when server is down", async () => {
    const proc = Bun.spawn(["sh", "hooks/capture.sh"], {
      stdin: "pipe",
      env: { ...process.env, POLARIS_PORT: "59999" },
    });
    proc.stdin.write('{"test": true}');
    proc.stdin.end();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });
});
