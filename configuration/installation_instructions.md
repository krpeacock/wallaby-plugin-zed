# Installing the Wallaby MCP server

This extension launches the **Wallaby MCP server** inside Zed's agent panel, giving
the agent live access to Wallaby's runtime context: failing tests, stack traces,
coverage, execution paths and runtime values.

## Prerequisites

1. **Node.js** — the MCP server runs on Node. Zed bundles its own Node, so no
   extra install is usually needed.
2. **Wallaby** — the MCP server connects to a *running* Wallaby instance, so
   Wallaby must be installed and started for the tools to return data.

## How the server is located

The extension auto-detects the Wallaby MCP server entry point in this order:

1. the `wallaby.mcp_entry` setting (see below), if set;
2. `~/.wallaby/mcp` (the canonical entry created by Wallaby's editor tooling);
3. the newest bundled server at `~/.wallaby/cli/<hash>/mcp/index.js`.

If none is found you'll see an error in the context server output, and you should
either install Wallaby or point the extension at the server explicitly.

## Optional: explicit entry point

If auto-detection can't find the server, set `mcp_entry` in your Zed
`settings.json` under `context_servers`:

```json
{
  "context_servers": {
    "wallaby": {
      "mcp_entry": "/Users/you/.wallaby/mcp"
    }
  }
}
```

## Starting Wallaby

The MCP server only serves live data once Wallaby is running on your project.
Start it in standalone mode from the project root (or start it from your usual
editor):

```sh
wallaby
```

Then, in Zed, open the **Agent** panel and add the **Wallaby** context server. You
should see the Wallaby tools appear. Ask the agent to run a test or inspect a
failing test to exercise them.
