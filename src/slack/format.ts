// --- Event → Slack message formatting ---

import type { PolarisEvent } from "../types";

// Formatting mode for user prompts
export type PromptStyle = "emoji" | "color" | "header";

let promptStyle: PromptStyle = "color";

export function setPromptStyle(style: PromptStyle) {
  promptStyle = style;
}

// Format a PolarisEvent into a Slack message.
// Returns null if the event should be skipped (e.g., tool calls).
export function formatEventForSlack(event: PolarisEvent): {
  text: string;
  blocks?: Array<Record<string, unknown>>;
  attachments?: Array<Record<string, unknown>>;
} | null {
  const payload = event.payload;

  // Hook events
  if ("hook_event_name" in payload) {
    switch (payload.hook_event_name) {
      case "UserPromptSubmit": {
        const sender = event.sender;
        const session = event.session;
        return formatUserPrompt(sender, session, payload.prompt);
      }
      case "Stop": {
        const session = event.session;
        const response = payload.stop_response || payload.last_assistant_message;
        if (!response) return null;
        return formatAgentResponse(event.sender, session, response);
      }
      case "PreToolUse":
      case "PostToolUse":
        return null;
    }
  }

  // Inject events (advisor messages)
  if ("type" in payload && payload.type === "inject") {
    return formatAdvisorMessage(
      event.sender,
      (payload as { target: string }).target,
      (payload as { content: string }).content,
    );
  }

  // Reply events
  if ("type" in payload && payload.type === "reply") {
    const body = (payload as { content: string }).content;
    if (!body) return null;
    return {
      text: `*${event.sender}* replied: ${body}`,
      blocks: [
        { type: "context", elements: [{ type: "mrkdwn", text: `*${event.sender}* replied` }] },
        { type: "section", text: { type: "mrkdwn", text: toMrkdwn(body) } },
      ],
    };
  }

  return null;
}

// --- User prompt formatting (three modes) ---

function formatUserPrompt(sender: string, session: string, prompt: string): {
  text: string;
  blocks?: Array<Record<string, unknown>>;
  attachments?: Array<Record<string, unknown>>;
} | null {
  if (!prompt) return null;
  const body = toMrkdwn(prompt);
  const header = `*${sender}* → _${session}_`;

  switch (promptStyle) {
    case "emoji":
      return {
        text: `💬 ${header}\n${body}`,
        blocks: [
          { type: "context", elements: [{ type: "mrkdwn", text: `💬 ${header}` }] },
          {
            type: "section",
            text: { type: "mrkdwn", text: `> ${body.split("\n").join("\n> ")}` },
          },
        ],
      };

    case "color":
      return {
        text: `${header}\n${body}`,
        attachments: [
          {
            color: "#4263eb", // polaris blue
            blocks: [
              { type: "context", elements: [{ type: "mrkdwn", text: header }] },
              { type: "section", text: { type: "mrkdwn", text: body } },
            ],
          },
        ],
      };

    case "header":
      return {
        text: `${header}\n${body}`,
        blocks: [
          { type: "header", text: { type: "plain_text", text: `${sender} → ${session}` } },
          { type: "section", text: { type: "mrkdwn", text: body } },
        ],
      };
  }
}

// --- Agent response formatting (always plain) ---

function formatAgentResponse(sender: string, session: string, response: string): {
  text: string;
  blocks?: Array<Record<string, unknown>>;
} | null {
  if (!response) return null;
  const body = toMrkdwn(response);
  const header = `_agent_ → *${sender}/${session}*`;

  return {
    text: `${header}\n${body}`,
    blocks: [
      { type: "context", elements: [{ type: "mrkdwn", text: header }] },
      { type: "section", text: { type: "mrkdwn", text: body } },
    ],
  };
}

// --- Advisor message formatting ---

function formatAdvisorMessage(sender: string, target: string, content: string): {
  text: string;
  blocks?: Array<Record<string, unknown>>;
  attachments?: Array<Record<string, unknown>>;
} | null {
  if (!content) return null;
  const body = toMrkdwn(content);
  const header = `*${sender}* → _${target}_`;

  // Advisors also get a color bar (green)
  return {
    text: `${header}\n${body}`,
    attachments: [
      {
        color: "#16a34a", // green
        blocks: [
          { type: "context", elements: [{ type: "mrkdwn", text: header }] },
          { type: "section", text: { type: "mrkdwn", text: body } },
        ],
      },
    ],
  };
}

// --- Markdown → Slack mrkdwn ---

function toMrkdwn(text: string): string {
  const maxLen = 2000;
  const truncated = text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
  return truncated
    .replace(/```(\w*)\n([\s\S]*?)```/g, "```$2```")
    .replace(/\*\*(.*?)\*\*/g, "*$1*")
    .replace(/__(.*?)__/g, "*$1*");
}
