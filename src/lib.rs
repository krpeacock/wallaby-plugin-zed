use schemars::JsonSchema;
use serde::Deserialize;
use zed::settings::ContextServerSettings;
use zed_extension_api::{
    self as zed, serde_json, Command, ContextServerConfiguration, ContextServerId, Project, Result,
};

const CONTEXT_SERVER_ID: &str = "wallaby";

/// POSIX `sh` script that resolves the Wallaby MCP server entry point and `exec`s
/// Node on it, so stdio (and thus the MCP handshake) passes straight through.
///
/// Resolution order:
/// 1. `$WALLABY_MCP_ENTRY` if set (from the `wallaby.mcp_entry` setting),
/// 2. the canonical `~/.wallaby/mcp`,
/// 3. the newest bundled `~/.wallaby/cli/<hash>/mcp/index.js`.
///
/// The context server child inherits Zed's environment, so `$HOME` and `$PATH`
/// are available here even though the WASM extension itself cannot read the
/// filesystem.
const RESOLVE_SCRIPT: &str = r#"
mcp="${WALLABY_MCP_ENTRY:-$HOME/.wallaby/mcp}"
if [ -z "$WALLABY_MCP_ENTRY" ] && [ ! -f "$mcp" ]; then
  mcp="$(ls -t "$HOME"/.wallaby/cli/*/mcp/index.js 2>/dev/null | head -n 1)"
fi
if [ -z "$mcp" ] || [ ! -f "$mcp" ]; then
  printf 'Wallaby MCP server not found. Install Wallaby, or set the `wallaby.mcp_entry` setting.\n' >&2
  exit 1
fi
node="${WALLABY_NODE:-$(command -v node)}"
if [ -z "$node" ]; then
  printf 'node not found on PATH.\n' >&2
  exit 1
fi
exec "$node" "$mcp"
"#;

#[derive(Debug, Deserialize, JsonSchema)]
struct WallabySettings {
    /// Absolute path to the Wallaby MCP server entry script (e.g. `~/.wallaby/mcp`).
    /// When set, the server is launched from this exact file instead of auto-detecting.
    #[serde(default)]
    mcp_entry: Option<String>,
}

impl Default for WallabySettings {
    fn default() -> Self {
        Self { mcp_entry: None }
    }
}

struct WallabyExtension;

impl zed::Extension for WallabyExtension {
    fn new() -> Self {
        Self
    }

    fn context_server_command(
        &mut self,
        _context_server_id: &ContextServerId,
        project: &Project,
    ) -> Result<Command> {
        let settings = ContextServerSettings::for_project(CONTEXT_SERVER_ID, project)?;
        let settings: WallabySettings = settings
            .settings
            .map(|value| serde_json::from_value(value).map_err(|e| e.to_string()))
            .transpose()?
            .unwrap_or_default();

        let mut env = vec![("WALLABY_NODE".to_string(), zed::node_binary_path()?)];
        if let Some(entry) = settings.mcp_entry {
            env.push(("WALLABY_MCP_ENTRY".to_string(), entry));
        }

        Ok(Command {
            command: "sh".to_string(),
            args: vec!["-c".to_string(), RESOLVE_SCRIPT.to_string()],
            env,
        })
    }

    fn context_server_configuration(
        &mut self,
        _context_server_id: &ContextServerId,
        _project: &Project,
    ) -> Result<Option<ContextServerConfiguration>> {
        let installation_instructions =
            include_str!("../configuration/installation_instructions.md").to_string();
        let default_settings =
            include_str!("../configuration/default_settings.jsonc").to_string();
        let settings_schema = serde_json::to_string(&schemars::schema_for!(WallabySettings))
            .map_err(|e| e.to_string())?;

        Ok(Some(ContextServerConfiguration {
            installation_instructions,
            default_settings,
            settings_schema,
        }))
    }
}

zed::register_extension!(WallabyExtension);

#[cfg(test)]
mod tests {
    use super::*;

    /// Verifies the resolution script finds the bundled server when the canonical
    /// `~/.wallaby/mcp` is absent (the common case: no editor-side tooling has
    /// provisioned it yet) and execs Node on it.
    #[test]
    fn resolves_bundled_server_when_canonical_missing() {
        let fixture = std::env::temp_dir().join("wallaby-mcp-fixture-canonical-missing");
        let cli_dir = fixture.join(".wallaby/cli/somehash/mcp");
        std::fs::create_dir_all(&cli_dir).unwrap();
        let entry = cli_dir.join("index.js");
        std::fs::write(&entry, "console.log('ok')\n").unwrap();

        // Point the script at the fixture as if it were HOME.
        let script = RESOLVE_SCRIPT.replace("$HOME", &fixture.display().to_string());

        // Leave WALLABY_NODE unset so the script falls back to `command -v node`.
        let output = std::process::Command::new("sh")
            .arg("-c")
            .arg(&script)
            .env_remove("WALLABY_NODE")
            .env_remove("WALLABY_MCP_ENTRY")
            .output()
            .expect("run resolution script");

        assert!(
            output.status.success(),
            "script failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            String::from_utf8_lossy(&output.stdout).trim(),
            "ok",
            "expected node to execute the resolved mcp entry"
        );
    }

    /// Verifies an explicit `mcp_entry` (via `$WALLABY_MCP_ENTRY`) is honored
    /// directly, skipping auto-detection entirely.
    #[test]
    fn honors_explicit_mcp_entry() {
        let fixture = std::env::temp_dir().join("wallaby-mcp-fixture-explicit-entry.js");
        std::fs::write(&fixture, "console.log('explicit')\n").unwrap();

        let output = std::process::Command::new("sh")
            .arg("-c")
            .arg(RESOLVE_SCRIPT)
            .env_remove("WALLABY_NODE")
            .env("WALLABY_MCP_ENTRY", &fixture)
            .output()
            .expect("run resolution script");

        assert!(
            output.status.success(),
            "script failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "explicit");
    }
}
