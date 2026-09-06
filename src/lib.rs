use schemars::JsonSchema;
use serde::Deserialize;
use zed::settings::ContextServerSettings;
use zed_extension_api::{
    self as zed, serde_json, Command, ContextServerConfiguration, ContextServerId, Project, Result,
};

const CONTEXT_SERVER_ID: &str = "wallaby";

/// Builds the POSIX `sh` script the context server runs.
///
/// The script resolves the Wallaby MCP server entry point, optionally
/// auto-starts a headless Wallaby instance on the project, then `exec`s Node
/// on the MCP server so stdio (and thus the MCP handshake) passes straight
/// through.
///
/// Entry-point resolution order:
/// 1. `$WALLABY_MCP_ENTRY` if set (from the `wallaby.mcp_entry` setting),
/// 2. the canonical `~/.wallaby/mcp`,
/// 3. the newest bundled `~/.wallaby/cli/<hash>/mcp/index.js`.
///
/// The context server child runs with the project root as its working
/// directory and inherits Zed's environment (HOME, PATH), so the shell can
/// resolve everything even though the WASM extension itself cannot read the
/// filesystem.
fn launcher_script(manager: Option<&str>, auto_start: bool) -> String {
    let mut script = String::from(
        r#"node="${WALLABY_NODE:-$(command -v node)}"
if [ -z "$node" ]; then
  printf 'node not found on PATH.\n' >&2
  exit 1
fi
mcp="${WALLABY_MCP_ENTRY:-$HOME/.wallaby/mcp}"
if [ -z "$WALLABY_MCP_ENTRY" ] && [ ! -f "$mcp" ]; then
  mcp="$(ls -t "$HOME"/.wallaby/cli/*/mcp/index.js 2>/dev/null | head -n 1)"
fi
if [ -z "$mcp" ] || [ ! -f "$mcp" ]; then
  printf 'Wallaby MCP server not found. Install Wallaby, or set the `wallaby.mcp_entry` setting.\n' >&2
  exit 1
fi
"#,
    );

    if auto_start {
        match manager {
            Some(manager) => script.push_str(&format!(
                "printf 'wallaby: auto-starting Wallaby...\\n' >&2\n\"$node\" \"{manager}\" start \"$PWD\" >&2 || printf 'wallaby: auto-start failed (is `wallaby` on PATH?)\\n' >&2\n"
            )),
            None => script.push_str(
                "printf 'wallaby: auto-start enabled but scripts/wallaby-manage.mjs is missing\\n' >&2\n",
            ),
        }
    }

    script.push_str("exec \"$node\" \"$mcp\"\n");
    script
}

/// Resolves a path relative to the extension's own directory, which Zed sets
/// as the working directory while constructing context server commands.
fn path_from_extension(path: &str) -> Result<String> {
    let extension_dir = std::env::current_dir().map_err(|e| e.to_string())?;
    Ok(extension_dir.join(path).to_string_lossy().into_owned())
}

#[derive(Debug, Deserialize, JsonSchema)]
struct WallabySettings {
    /// Absolute path to the Wallaby MCP server entry script (e.g. `~/.wallaby/mcp`).
    /// When set, the server is launched from this exact file instead of auto-detecting.
    #[serde(default)]
    mcp_entry: Option<String>,
    /// Start a headless Wallaby instance on the project when the context
    /// server launches (default: true). Set to false if you start Wallaby
    /// yourself (e.g. from an IDE) and only want the MCP connection.
    #[serde(default = "default_true")]
    auto_start: bool,
}

fn default_true() -> bool {
    true
}

impl Default for WallabySettings {
    fn default() -> Self {
        Self {
            mcp_entry: None,
            auto_start: true,
        }
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

        // The bundled manager script (scripts/wallaby-manage.js) is referenced
        // from the extension dir; the shell sub-process can read it even though
        // the WASM cannot.
        let manager = path_from_extension("scripts/wallaby-manage.mjs")
            .ok()
            .filter(|p| std::path::Path::new(p).exists());
        if let Some(manager) = &manager {
            env.push(("WALLABY_MANAGER".to_string(), manager.clone()));
        }

        if let Some(entry) = settings.mcp_entry {
            env.push(("WALLABY_MCP_ENTRY".to_string(), entry));
        }

        Ok(Command {
            command: "sh".to_string(),
            args: vec!["-c".to_string(), launcher_script(manager.as_deref(), settings.auto_start)],
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

    /// Verifies the launcher finds the bundled server when the canonical
    /// `~/.wallaby/mcp` is absent (the common case: no editor-side tooling has
    /// provisioned it yet) and execs Node on it.
    #[test]
    fn launcher_resolves_bundled_server_when_canonical_missing() {
        let fixture = std::env::temp_dir().join("wallaby-mcp-fixture-canonical-missing");
        let cli_dir = fixture.join(".wallaby/cli/somehash/mcp");
        std::fs::create_dir_all(&cli_dir).unwrap();
        let entry = cli_dir.join("index.js");
        std::fs::write(&entry, "console.log('ok')\n").unwrap();

        // Point the script at the fixture as if it were HOME.
        let script = launcher_script(None, false).replace("$HOME", &fixture.display().to_string());

        // Leave WALLABY_NODE unset so the script falls back to `command -v node`.
        let output = std::process::Command::new("sh")
            .arg("-c")
            .arg(&script)
            .env_remove("WALLABY_NODE")
            .env_remove("WALLABY_MCP_ENTRY")
            .output()
            .expect("run launcher script");

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
    fn launcher_honors_explicit_mcp_entry() {
        let fixture = std::env::temp_dir().join("wallaby-mcp-fixture-explicit-entry.js");
        std::fs::write(&fixture, "console.log('explicit')\n").unwrap();

        let output = std::process::Command::new("sh")
            .arg("-c")
            .arg(launcher_script(None, false))
            .env_remove("WALLABY_NODE")
            .env("WALLABY_MCP_ENTRY", &fixture)
            .output()
            .expect("run launcher script");

        assert!(
            output.status.success(),
            "script failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "explicit");
    }

    /// Verifies the auto-start step is emitted only when enabled, and only
    /// when the manager script is available.
    #[test]
    fn launcher_auto_start_step_respects_settings() {
        let with_manager = launcher_script(Some("/abs/path/wallaby-manage.mjs"), true);
        assert!(with_manager.contains("start \"$PWD\""), "expected auto-start step");

        let without_manager = launcher_script(None, true);
        assert!(
            !without_manager.contains("start \"$PWD\""),
            "no start step without the manager script"
        );
        assert!(without_manager.contains("wallaby-manage.mjs is missing"));

        let disabled = launcher_script(Some("/abs/path/wallaby-manage.mjs"), false);
        assert!(!disabled.contains("start \"$PWD\""), "no auto-start when disabled");
    }
}