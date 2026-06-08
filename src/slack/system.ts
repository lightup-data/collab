// --- Slack system channel: create, post events ---

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

// Post a system event to the #polaris channel.
export async function postSystemEvent(
  botToken: string,
  channelId: string,
  text: string,
  context?: string
): Promise<void> {
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
    text, // fallback for notifications
    blocks,
  });
}
