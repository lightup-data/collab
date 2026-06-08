import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// --- Configuration ---

export interface ClientConfig {
  project: string;
  session: string;
  user: string; // participant ID, e.g. "user:manu"
  serviceUrl: string; // cloud service base URL, e.g. "http://localhost:4321"
  localPort: number; // local HTTP port for hook relay
}

function getConfig(): ClientConfig {
  const project = process.env.POLARIS_PROJECT;
  const session = process.env.POLARIS_SESSION;
  const user = process.env.POLARIS_USER;
  const serviceUrl = process.env.POLARIS_SERVICE_URL ?? "http://localhost:4321";
  const localPort = Number(process.env.POLARIS_PORT ?? 4321);

  if (!project || !session || !user) {
    console.error("Required env vars: POLARIS_PROJECT, POLARIS_SESSION, POLARIS_USER");
    process.exit(1);
  }

  return { project, session, user, serviceUrl, localPort };
}

// --- Cloud service helpers ---

async function servicePost(serviceUrl: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${serviceUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function serviceGet(serviceUrl: string, path: string): Promise<Response> {
  return fetch(`${serviceUrl}${path}`);
}

// --- Start client ---

export async function startClient(config: ClientConfig) {
  const { project, session, user, serviceUrl, localPort } = config;

  // --- MCP Channel Server ---

  const mcp = new Server(
    { name: "polaris", version: "0.0.1" },
    {
      capabilities: {
        experimental: { "claude/channel": {} },
        tools: {},
      },
      instructions: `You are connected to a polaris session. Messages from advisors and teammates arrive as <channel source="polaris" from="..."> tags. Use the polaris_reply tool to send messages back. Use the polaris_context tool to fetch activity from sibling sessions in this project.`,
    }
  );

  // Reply tool — Claude uses this to send messages back
  // Context tool — Claude uses this to pull sibling session history
  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "polaris_reply",
        description: "Send a message back to the project floor (visible to all advisors and the Slack/WhatsApp channel)",
        inputSchema: {
          type: "object" as const,
          properties: {
            message: { type: "string", description: "Message to send" },
          },
          required: ["message"],
        },
      },
      {
        name: "polaris_context",
        description: "Fetch activity from a sibling session in this project. Use this to see what other drivers have been doing.",
        inputSchema: {
          type: "object" as const,
          properties: {
            session: { type: "string", description: "Name of the sibling session to fetch context from" },
          },
          required: ["session"],
        },
      },
    ],
  }));

  mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;

    if (name === "polaris_reply") {
      const message = (args as { message: string }).message;
      await servicePost(serviceUrl, `/projects/${project}/sessions/${session}/events`, {
        sender: user,
        payload: {
          hook_event_name: "Stop",
          session_id: "polaris-reply",
          stop_response: message,
        },
      });
      return { content: [{ type: "text", text: "Reply sent to the floor." }] };
    }

    if (name === "polaris_context") {
      const targetSession = (args as { session: string }).session;
      const res = await serviceGet(serviceUrl, `/projects/${project}/sessions/${targetSession}/messages`);
      if (!res.ok) {
        return { content: [{ type: "text", text: `Could not fetch session "${targetSession}": ${res.status}` }] };
      }
      const events = await res.json();
      const summary = (events as Array<{ sender: string; payload: { prompt?: string; stop_response?: string; content?: string } }>)
        .map((e) => {
          const p = e.payload;
          const text = p.prompt ?? p.stop_response ?? p.content ?? JSON.stringify(p);
          return `[${e.sender}] ${text}`;
        })
        .join("\n");
      return { content: [{ type: "text", text: summary || "(no activity yet)" }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  // --- WebSocket to cloud service ---

  const wsUrl = serviceUrl.replace(/^http/, "ws");
  let ws: WebSocket | null = null;

  function connectWs() {
    ws = new WebSocket(`${wsUrl}/projects/${project}/sessions/${session}/ws`);
    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data as string);
        // Only inject advisor messages (source: "inject") into the MCP session
        if (data.source === "inject") {
          const sender = data.sender ?? "unknown";
          const content = data.payload?.content ?? JSON.stringify(data.payload);
          await mcp.notification({
            method: "notifications/claude/channel",
            params: {
              content,
              meta: { from: sender, session: data.session, source: "polaris" },
            },
          });
        }
      } catch {
        // Ignore malformed messages
      }
    };
    ws.onclose = () => {
      // Reconnect after delay
      setTimeout(connectWs, 3000);
    };
    ws.onerror = () => {
      // Will trigger onclose
    };
  }

  connectWs();

  // --- Local HTTP server for hook relay ---

  const httpServer = Bun.serve({
    port: localPort,
    hostname: "127.0.0.1",

    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "POST" && url.pathname === "/events") {
        try {
          const body = await req.json();
          // Relay hook event to cloud service
          const res = await servicePost(
            serviceUrl,
            `/projects/${project}/sessions/${session}/events`,
            { sender: user, payload: body }
          );
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

  // --- Connect MCP stdio ---

  const transport = new StdioServerTransport();
  await mcp.connect(transport);

  console.error(`Polaris client started: ${project}/${session} as ${user}`);
  console.error(`Hook relay on http://127.0.0.1:${localPort}/events`);
  console.error(`Connected to ${serviceUrl}`);

  return {
    mcp,
    httpServer,
    ws,
    stop: () => {
      httpServer.stop(true);
      ws?.close();
    },
  };
}

// --- Run if executed directly ---
if (import.meta.main) {
  await startClient(getConfig());
}
