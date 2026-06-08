// --- Slack system channel: create, post events, persist to DB ---

import { pushEvent, createProject, getProject, getOrg, type Sql } from "../service/db";
import type { PolarisEvent } from "../types";

const SYSTEM_CHANNEL_NAME = "polaris-system";

async function slackApi(token: string, method: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return (await res.json()) as Record<string, unknown>;
}

// Look up a Slack user ID by email.
async function lookupSlackUser(botToken: string, email: string): Promise<string | null> {
  const res = await slackApi(botToken, "users.lookupByEmail", { email });
  if (res.ok) return (res.user as { id: string }).id;
  return null;
}

// Create the #polaris-system channel and return its ID.
// If it already exists, join it and return its ID.
// Optionally invites a user (by email) to the channel.
export async function createSystemChannel(botToken: string, inviteEmail?: string): Promise<string> {
  // Try to create
  const createRes = await slackApi(botToken, "conversations.create", {
    name: SYSTEM_CHANNEL_NAME,
    is_private: false,
  });

  if (createRes.ok) {
    const channelId = (createRes.channel as { id: string }).id;
    await slackApi(botToken, "conversations.setTopic", {
      channel: channelId,
      topic: "Polaris system events — device connections, sessions, handoffs",
    });
    if (inviteEmail) {
      const slackUserId = await lookupSlackUser(botToken, inviteEmail);
      if (slackUserId) {
        await slackApi(botToken, "conversations.invite", { channel: channelId, users: slackUserId });
      }
    }
    return channelId;
  }

  // Channel already exists — find it and join
  if (createRes.error === "name_taken") {
    // Search for it
    let cursor: string | undefined;
    do {
      const listRes = await slackApi(botToken, "conversations.list", {
        types: "public_channel",
        limit: 200,
        exclude_archived: true,
        ...(cursor ? { cursor } : {}),
      }) as { ok: boolean; channels?: Array<{ id: string; name: string }>; response_metadata?: { next_cursor?: string } };

      if (listRes.ok && listRes.channels) {
        const found = listRes.channels.find((c) => c.name === SYSTEM_CHANNEL_NAME);
        if (found) {
          await slackApi(botToken, "conversations.join", { channel: found.id });
          if (inviteEmail) {
            const slackUserId = await lookupSlackUser(botToken, inviteEmail);
            if (slackUserId) {
              await slackApi(botToken, "conversations.invite", { channel: found.id, users: slackUserId });
            }
          }
          return found.id;
        }
      }
      cursor = listRes.response_metadata?.next_cursor || undefined;
    } while (cursor);
  }

  throw new Error(`Failed to create or find #${SYSTEM_CHANNEL_NAME} channel: ${createRes.error}`);
}

// Ensure the _system project exists for an org.
async function ensureSystemProject(sql: Sql, orgId: string): Promise<void> {
  const existing = await getProject(sql, orgId, "_system");
  if (!existing) {
    try {
      await createProject(sql, orgId, "_system");
    } catch {
      // Already exists (race condition)
    }
  }
}

// Post a system event — persists to DB and optionally posts to Slack.
export async function postSystemEvent(opts: {
  sql: Sql;
  orgId: string;
  sender: string;
  text: string;
  context?: string;
  botToken?: string;
  channelId?: string;
}): Promise<void> {
  const { sql, orgId, sender, text, context, botToken, channelId } = opts;

  // Persist to DB under _system project and _system session
  await ensureSystemProject(sql, orgId);
  const event: PolarisEvent = {
    id: crypto.randomUUID(),
    project: "_system",
    session: "_system",
    timestamp: new Date().toISOString(),
    source: "inject",
    sender: sender as PolarisEvent["sender"],
    payload: {
      type: "inject" as const,
      content: context ? `${text}\n${context}` : text,
      sender: sender as PolarisEvent["sender"],
      target: "_system",
    },
  };
  await pushEvent(sql, orgId, event);

  // Post to Slack if connected
  if (botToken && channelId) {
    const blocks: Array<Record<string, unknown>> = [
      {
        type: "section",
        text: { type: "mrkdwn", text },
      },
    ];

    if (context) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: context }],
      });
    }

    await slackApi(botToken, "chat.postMessage", {
      channel: channelId,
      text,
      blocks,
    });
  }
}

// Post a _system event to Slack if the org has credentials.
// Called by the cloud service when it receives a _system project event.
export async function postToSlackSystemChannel(sql: Sql, orgId: string, text: string): Promise<void> {
  try {
    const org = await getOrg(sql, orgId);
    if (!org?.slack_bot_token || !org?.slack_system_channel_id) return;

    await slackApi(org.slack_bot_token, "chat.postMessage", {
      channel: org.slack_system_channel_id,
      text,
    });
  } catch {
    // Non-fatal
  }
}
