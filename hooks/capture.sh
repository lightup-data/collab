#!/bin/sh
# hooks/capture.sh - Forward Claude Code hook events to polaris local client
# Reads hook JSON from stdin, POSTs to the local polaris client.
# Always exits 0 to avoid blocking the coding agent.

POLARIS_PORT="${POLARIS_PORT:-4321}"
POLARIS_URL="http://127.0.0.1:${POLARIS_PORT}/events"

# Read all of stdin
INPUT=$(cat)

# POST to polaris local client, fail silently
curl -s -X POST \
  -H "Content-Type: application/json" \
  -d "$INPUT" \
  "$POLARIS_URL" \
  >/dev/null 2>&1 || true

exit 0
