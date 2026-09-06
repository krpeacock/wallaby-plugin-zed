# Wallaby for Zed

A [Zed](https://zed.dev) extension that exposes the **Wallaby.js MCP server** to
Zed's agent, giving the agent live runtime context from your codebase: failing
tests, stack traces, coverage, execution paths and runtime values.

> **Status: MVP.** The first milestone is *getting the MCP server running* in
> Zed's agent panel. Richer features (starting Wallaby from the extension,
> inline test decorations, a test panel) will be added iteratively on top.

## What it does

- Declares a **Wallaby** context server (MCP).
- Launches the Wallaby MCP server (`node ~/.wallaby/mcp`, falling back to the
  bundled `~/.wallaby/cli/<hash>/mcp/index.js`).
- Auto-detects the server entry point, with an optional `wallaby.mcp_entry`
  setting override.

## Requirements

- Zed (any recent release that supports context-server extensions).
- Wallaby installed and **running** on your project — the MCP server connects to
  a live Wallaby instance. Start it with `wallaby` from the project root.

## Install as a dev extension

1. Clone / open this directory.
2. In Zed, open the Extensions panel → **Install Dev Extension**, and select this
   directory.
3. In the **Agent** panel, add the **Wallaby** context server. You should see the
   Wallaby tools appear.

## Settings

| Key                        | Type   | Description                                                   |
| -------------------------- | ------ | ------------------------------------------------------------- |
| `context_servers.wallaby.mcp_entry` | string | Optional absolute path to the Wallaby MCP server entry script. |

Example `settings.json`:

```json
{
  "context_servers": {
    "wallaby": {
      "mcp_entry": "/Users/you/.wallaby/mcp"
    }
  }
}
```

## Development

```sh
# Install the wasm target (Zed does this too, but handy for local builds)
rustup target add wasm32-wasip2

# Build the extension wasm
cargo build --release --target wasm32-wasip2

# Run unit tests (resolution logic + settings)
cargo test
```

## Roadmap

- [x] MVP: MCP server connects inside Zed's agent panel
- [ ] Start / manage the Wallaby instance from the extension
- [ ] Inline test result decorations
- [ ] Test panel / tree integration

## License

MIT
