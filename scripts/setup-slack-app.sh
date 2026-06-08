#!/bin/sh
# scripts/setup-slack-app.sh
# Creates a Slack app for Polaris and outputs credentials.
# Requires a Slack workspace admin token or manual steps.
#
# Unfortunately, Slack does not provide a CLI or API to create apps
# programmatically. This script automates what it can and opens the
# browser for the manual steps.

set -e

REDIRECT_URI="http://localhost:3000/slack/callback"
ENV_FILE=".env"

echo "=== Setting up Slack App for Polaris ==="
echo ""
echo "This script will open your browser to create a Slack app."
echo "Follow the steps, then paste the credentials here."
echo ""

# Step 1: Create the app
echo "Step 1: Create the Slack app"
echo "---"
echo "  1. Click 'Create New App' → 'From scratch'"
echo "  2. App Name: Polaris"
echo "  3. Workspace: your development workspace"
echo "  4. Click 'Create App'"
echo ""
open "https://api.slack.com/apps" 2>/dev/null || xdg-open "https://api.slack.com/apps" 2>/dev/null || echo "Open https://api.slack.com/apps in your browser"
echo "Press Enter when the app is created..."
read -r

# Step 2: OAuth redirect
echo ""
echo "Step 2: Set up OAuth"
echo "---"
echo "  1. In the left sidebar, go to 'OAuth & Permissions'"
echo "  2. Under 'Redirect URLs', click 'Add New Redirect URL'"
echo "  3. Add: ${REDIRECT_URI}"
echo "  4. Click 'Save URLs'"
echo ""
echo "  5. Scroll to 'Bot Token Scopes' and add these scopes:"
echo "     - channels:manage"
echo "     - channels:join"
echo "     - channels:read"
echo "     - chat:write"
echo "     - users:read"
echo "     - users:read.email"
echo ""
echo "Press Enter when done..."
read -r

# Step 3: Enable Socket Mode
echo ""
echo "Step 3: Enable Socket Mode"
echo "---"
echo "  1. In the left sidebar, go to 'Socket Mode'"
echo "  2. Toggle 'Enable Socket Mode' on"
echo "  3. Name the token: polaris-socket"
echo "  4. Scope: connections:write (should be pre-selected)"
echo "  5. Click 'Generate'"
echo "  6. Copy the token (starts with xapp-)"
echo ""
echo "Press Enter when done..."
read -r

# Step 4: Enable Events (required for Socket Mode)
echo ""
echo "Step 4: Enable Events"
echo "---"
echo "  1. In the left sidebar, go to 'Event Subscriptions'"
echo "  2. Toggle 'Enable Events' on"
echo "  3. Under 'Subscribe to bot events', add:"
echo "     - message.channels"
echo "  4. Click 'Save Changes'"
echo ""
echo "Press Enter when done..."
read -r

# Step 5: Collect credentials
echo ""
echo "Step 5: Collect credentials"
echo "---"
echo "  Go to 'Basic Information' in the left sidebar."
echo ""

printf "Paste your Client ID: "
read -r SLACK_CLIENT_ID

printf "Paste your Client Secret: "
read -r SLACK_CLIENT_SECRET

printf "Paste your Socket Mode token (xapp-...): "
read -r SLACK_APP_TOKEN

if [ -z "$SLACK_CLIENT_ID" ] || [ -z "$SLACK_CLIENT_SECRET" ] || [ -z "$SLACK_APP_TOKEN" ]; then
  echo ""
  echo "ERROR: All three values are required."
  exit 1
fi

# Append to .env (preserve existing content)
echo "" >> "$ENV_FILE"
echo "# Slack" >> "$ENV_FILE"
echo "SLACK_CLIENT_ID=${SLACK_CLIENT_ID}" >> "$ENV_FILE"
echo "SLACK_CLIENT_SECRET=${SLACK_CLIENT_SECRET}" >> "$ENV_FILE"
echo "SLACK_APP_TOKEN=${SLACK_APP_TOKEN}" >> "$ENV_FILE"
echo "SLACK_REDIRECT_URI=${REDIRECT_URI}" >> "$ENV_FILE"

echo ""
echo "=== Done! ==="
echo "Credentials appended to ${ENV_FILE}"
echo ""
echo "Restart the dev server: make clean && make dev"
echo "Then click 'Connect Slack' on the dashboard."
