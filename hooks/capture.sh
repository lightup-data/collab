#!/bin/sh
# hooks/capture.sh - Forward Claude Code hook events to collab local client
# Reads hook JSON from stdin, POSTs to the local collab client.
# Always exits 0 to avoid blocking the coding agent.

COLLAB_PORT="${COLLAB_PORT:-4321}"
COLLAB_URL="http://127.0.0.1:${COLLAB_PORT}/events"

# Read all of stdin
INPUT=$(cat)

# POST to collab local client, fail silently
curl -s -X POST \
  -H "Content-Type: application/json" \
  -d "$INPUT" \
  "$COLLAB_URL" \
  >/dev/null 2>&1 || true

exit 0
