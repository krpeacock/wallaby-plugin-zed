#!/usr/bin/env bash
# Verify the Wallaby MCP server actually starts and answers an MCP initialize
# handshake, using the same resolution logic the Zed extension emits.
#
# This is the falsifiable check for the MVP goal: "get the MCP running".
# Exit 0 when the server responds with the Wallaby identity; non-zero otherwise.
set -euo pipefail

# Resolve the Wallaby MCP server entry point (mirrors src/lib.rs RESOLVE_SCRIPT).
mcp="${WALLABY_MCP_ENTRY:-$HOME/.wallaby/mcp}"
if [ -z "${WALLABY_MCP_ENTRY:-}" ] && [ ! -f "$mcp" ]; then
  mcp="$(ls -t "$HOME"/.wallaby/cli/*/mcp/index.js 2>/dev/null | head -n 1)"
fi
if [ -z "$mcp" ] || [ ! -f "$mcp" ]; then
  echo "wallaby-mcp: server not found (looked at \$WALLABY_MCP_ENTRY, ~/.wallaby/mcp, ~/.wallaby/cli/*/mcp/index.js)" >&2
  exit 1
fi

node="${WALLABY_NODE:-$(command -v node)}"
if [ -z "$node" ]; then
  echo "wallaby-mcp: node not found on PATH" >&2
  exit 1
fi

echo "wallaby-mcp: launching '$node' '$mcp'"
RESPONSE="$(
  { printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"zed-wallaby-check","version":"0"}}}'; sleep 2; printf '\n'; } \
    | "$node" "$mcp" 2>/tmp/wallaby-mcp-check.err
)"

echo "wallaby-mcp: response: $RESPONSE"

if printf '%s' "$RESPONSE" | grep -q '"name":"wallaby"'; then
  echo "wallaby-mcp: OK - Wallaby MCP server is running"
  exit 0
else
  echo "wallaby-mcp: FAILED - did not see Wallaby identity in initialize response" >&2
  cat /tmp/wallaby-mcp-check.err >&2 || true
  exit 1
fi
