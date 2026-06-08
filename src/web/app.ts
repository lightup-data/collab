import { Hono } from "hono";
import { Google } from "arctic";
import { createToken, verifyToken } from "../service/auth";
import {
  createOrg,
  getOrg,
  getOrgByDomain,
  createUser,
  getUserByEmail,
  upsertUser,
  setOrgSlack,
  type Sql,
  type Org,
} from "../service/db";

// --- Google OAuth setup ---

function getGoogle(): Google {
  return new Google(
    process.env.GOOGLE_CLIENT_ID ?? "",
    process.env.GOOGLE_CLIENT_SECRET ?? "",
    process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/auth/google/callback"
  );
}

// --- State store for OAuth CSRF (in-memory, fine for single instance) ---

const oauthStates = new Map<string, { type: "login" | "signup"; orgName?: string; timestamp: number }>();

// Clean up stale states every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of oauthStates) {
    if (now - val.timestamp > 10 * 60 * 1000) oauthStates.delete(key);
  }
}, 10 * 60 * 1000);

// --- HTML helpers ---

function html(body: string, title = "Polaris"): Response {
  return new Response(
    `<!DOCTYPE html>
<html>
<head><title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
  h1 { font-size: 1.5em; }
  a { color: #0066cc; }
  .btn { display: inline-block; padding: 10px 24px; background: #0066cc; color: white; text-decoration: none; border-radius: 6px; margin: 8px 0; }
  .btn:hover { background: #0052a3; }
  .btn-secondary { background: #4A154B; }
  .btn-secondary:hover { background: #3a1039; }
  .card { border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin: 12px 0; }
  .success { color: #16a34a; }
  .error { color: #dc2626; }
  code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
  pre { background: #f3f4f6; padding: 12px; border-radius: 6px; overflow-x: auto; }
</style>
</head>
<body>${body}</body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}

// --- App factory ---

export function createApp(sql: Sql) {
  const app = new Hono();

  // --- Landing page ---

  app.get("/", (c) => {
    return html(`
      <h1>Polaris</h1>
      <p>Multiplayer collaboration for AI agents and humans.</p>
      <a class="btn" href="/signup">Sign up your organization</a>
      <a class="btn" href="/login" style="background: #374151;">Log in</a>
    `);
  });

  // --- Signup flow (create org + first user) ---

  app.get("/signup", async (c) => {
    return html(`
      <h1>Sign up your organization</h1>
      <form action="/signup/start" method="POST">
        <label>Organization name:<br>
          <input type="text" name="orgName" required style="padding: 8px; width: 300px; margin: 4px 0;">
        </label><br><br>
        <button type="submit" class="btn">Continue with Google</button>
      </form>
    `, "Polaris - Sign Up");
  });

  app.post("/signup/start", async (c) => {
    const body = await c.req.parseBody();
    const orgName = body.orgName as string;
    if (!orgName) return html(`<p class="error">Organization name required.</p>`);

    const google = getGoogle();
    const state = crypto.randomUUID();
    oauthStates.set(state, { type: "signup", orgName, timestamp: Date.now() });
    const codeVerifier = crypto.randomUUID();
    const url = google.createAuthorizationURL(state, codeVerifier, ["openid", "email", "profile"]);
    // Store code verifier alongside state
    oauthStates.set(`cv:${state}`, { type: "signup", orgName: codeVerifier, timestamp: Date.now() });
    return c.redirect(url.toString());
  });

  // --- Login flow (existing user) ---

  app.get("/login", async (c) => {
    const google = getGoogle();
    const state = crypto.randomUUID();
    oauthStates.set(state, { type: "login", timestamp: Date.now() });
    const codeVerifier = crypto.randomUUID();
    oauthStates.set(`cv:${state}`, { type: "login", orgName: codeVerifier, timestamp: Date.now() });
    const url = google.createAuthorizationURL(state, codeVerifier, ["openid", "email", "profile"]);
    return c.redirect(url.toString());
  });

  // --- Google OAuth callback ---

  app.get("/auth/google/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) return html(`<p class="error">Missing code or state.</p>`);

    const stateData = oauthStates.get(state);
    const cvData = oauthStates.get(`cv:${state}`);
    if (!stateData || !cvData) return html(`<p class="error">Invalid or expired OAuth state.</p>`);
    oauthStates.delete(state);
    oauthStates.delete(`cv:${state}`);

    const google = getGoogle();
    const codeVerifier = cvData.orgName!;

    let tokens;
    try {
      tokens = await google.validateAuthorizationCode(code, codeVerifier);
    } catch {
      return html(`<p class="error">Failed to validate authorization code.</p>`);
    }

    // Fetch user info from Google
    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokens.accessToken()}` },
    });
    const userInfo = (await userInfoRes.json()) as { sub: string; email: string; name: string };
    const email = userInfo.email;
    const name = userInfo.name;
    const domain = email.split("@")[1];

    if (stateData.type === "signup") {
      // Create org
      const orgId = crypto.randomUUID();
      const orgName = stateData.orgName!;
      try {
        await createOrg(sql, orgId, orgName, domain);
      } catch {
        return html(`<p class="error">Failed to create organization. It may already exist.</p>`);
      }

      // Create first user
      const userId = crypto.randomUUID();
      const participantId = `user:${name.toLowerCase().replace(/\s+/g, ".")}`;
      await createUser(sql, userId, email, name, orgId, participantId);

      const token = await createToken({ sub: userId, email, name, org_id: orgId, participant_id: participantId });

      return html(`
        <h1 class="success">Organization created!</h1>
        <div class="card">
          <p><strong>Organization:</strong> ${orgName}</p>
          <p><strong>You:</strong> ${name} (${participantId})</p>
        </div>
        <h2>Next steps</h2>
        <ol>
          <li><a href="/dashboard?token=${token}">Go to dashboard</a> to connect Slack</li>
          <li>Share this with your team: <code>npx @lightup/polaris login</code></li>
        </ol>
        <h2>Your API token</h2>
        <p>Save this — you'll need it for the CLI:</p>
        <pre>${token}</pre>
      `, "Polaris - Welcome!");
    }

    // Login flow
    const existingUser = await getUserByEmail(sql, email);
    if (!existingUser) {
      // Check if org exists for this domain (auto-join)
      const org = await getOrgByDomain(sql, domain);
      if (org) {
        const userId = crypto.randomUUID();
        const participantId = `user:${name.toLowerCase().replace(/\s+/g, ".")}`;
        await createUser(sql, userId, email, name, org.id, participantId);
        const token = await createToken({ sub: userId, email, name, org_id: org.id, participant_id: participantId });
        return html(`
          <h1 class="success">Welcome to ${org.name}!</h1>
          <p>Auto-joined via your email domain.</p>
          <p><a class="btn" href="/dashboard?token=${token}">Go to dashboard</a></p>
          <h2>Your API token</h2>
          <pre>${token}</pre>
        `, "Polaris - Welcome!");
      }
      return html(`<p class="error">No account found for ${email}. Ask your admin to invite you, or <a href="/signup">sign up a new organization</a>.</p>`);
    }

    const token = await createToken({
      sub: existingUser.id,
      email: existingUser.email,
      name: existingUser.name,
      org_id: existingUser.org_id,
      participant_id: existingUser.participant_id,
    });

    return html(`
      <h1>Welcome back, ${existingUser.name}!</h1>
      <p><a class="btn" href="/dashboard?token=${token}">Go to dashboard</a></p>
      <h2>Your API token</h2>
      <p>Use this for the CLI (<code>polaris login</code>):</p>
      <pre>${token}</pre>
    `, "Polaris - Logged In");
  });

  // --- Dashboard ---

  app.get("/dashboard", async (c) => {
    const token = c.req.query("token");
    if (!token) return html(`<p class="error">No token provided. <a href="/login">Log in</a></p>`);

    const payload = await verifyToken(token);
    if (!payload) return html(`<p class="error">Invalid or expired token. <a href="/login">Log in again</a></p>`);

    const org = await getOrg(sql, payload.org_id);
    if (!org) return html(`<p class="error">Organization not found.</p>`);

    const slackConnected = !!org.slack_team_id;
    const slackSection = slackConnected
      ? `<div class="card"><p class="success">Slack connected (team: ${org.slack_team_id})</p></div>`
      : `<div class="card">
           <p>Connect Slack to enable the floor for your projects.</p>
           <a class="btn btn-secondary" href="/slack/install?token=${token}">Connect Slack</a>
         </div>`;

    return html(`
      <h1>${org.name} Dashboard</h1>
      <div class="card">
        <p><strong>User:</strong> ${payload.name} (${payload.participant_id})</p>
        <p><strong>Email:</strong> ${payload.email}</p>
        <p><strong>Org:</strong> ${org.name}</p>
      </div>
      <h2>Slack Integration</h2>
      ${slackSection}
      <h2>Setup for your team</h2>
      <p>Share this with your team members:</p>
      <pre>npx @lightup/polaris login</pre>
      <h2>API Token</h2>
      <pre>${token}</pre>
    `, "Polaris - Dashboard");
  });

  // --- Slack OAuth (placeholder — needs real Slack app credentials) ---

  app.get("/slack/install", async (c) => {
    const token = c.req.query("token");
    const slackClientId = process.env.SLACK_CLIENT_ID;
    if (!slackClientId) {
      return html(`<p class="error">Slack integration not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET.</p>`);
    }

    const state = `${token}`;
    const scopes = "channels:manage,channels:join,chat:write,channels:read,users:read,users:read.email";
    const url = `https://slack.com/oauth/v2/authorize?client_id=${slackClientId}&scope=${scopes}&state=${state}&redirect_uri=${encodeURIComponent(process.env.SLACK_REDIRECT_URI ?? "http://localhost:3000/slack/callback")}`;
    return c.redirect(url);
  });

  app.get("/slack/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state"); // contains the JWT token
    if (!code || !state) return html(`<p class="error">Missing code or state.</p>`);

    const payload = await verifyToken(state);
    if (!payload) return html(`<p class="error">Invalid token.</p>`);

    // Exchange code for Slack bot token
    const slackRes = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID ?? "",
        client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
        code,
        redirect_uri: process.env.SLACK_REDIRECT_URI ?? "http://localhost:3000/slack/callback",
      }),
    });
    const slackData = (await slackRes.json()) as { ok: boolean; team?: { id: string }; access_token?: string; error?: string };

    if (!slackData.ok) {
      return html(`<p class="error">Slack OAuth failed: ${slackData.error}</p>`);
    }

    await setOrgSlack(sql, payload.org_id, slackData.team!.id, slackData.access_token!);

    return html(`
      <h1 class="success">Slack connected!</h1>
      <p>Your workspace is now linked to Polaris. Channels will be auto-created for your projects.</p>
      <p><a class="btn" href="/dashboard?token=${state}">Back to dashboard</a></p>
    `, "Polaris - Slack Connected");
  });

  // --- CLI token endpoint (for polaris login) ---

  app.get("/auth/token", async (c) => {
    const token = c.req.query("token");
    if (!token) return c.json({ error: "No token" }, 400);
    const payload = await verifyToken(token);
    if (!payload) return c.json({ error: "Invalid token" }, 401);
    return c.json(payload);
  });

  return app;
}
