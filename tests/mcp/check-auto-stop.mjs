// Verifies the auto-start AND auto-stop behavior of the launcher the Zed
// extension produces, emulating Zed's context-server lifecycle:
//
//   1. spawn the launcher (`sh -c <script>`) detached — like Zed, this puts it
//      in its own session/process group (pgid == pid)
//   2. the launcher auto-starts Wallaby (SAME process group)
//   3. teardown: killpg(the launcher's pid) — exactly what Zed's
//      StdioTransport::drop does
//   4. assert Wallaby is gone afterwards ("stopped")
//
// Usage: node check-auto-stop.mjs   (from tests/mcp)
//        npm run verify:autostop

import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(fixtureDir, '..', '..');
const manager = path.join(repoRoot, 'scripts', 'wallaby-manage.mjs');

// Reproduce the launcher the extension emits (auto_start on, manager present).
function launcherScript() {
  // Resolve the bundled MCP server the same way RESOLVE_SCRIPT would.
  const mcp = process.env.WALLABY_MCP || resolveBundledMcp();
  return [
    `node="${process.env.WALLABY_NODE || 'node'}"`,
    `mcp="${mcp}"`,
    `printf 'wallaby: auto-starting Wallaby...\n' >&2`,
    `"$node" "${manager}" start "$PWD" >&2 || printf 'wallaby: auto-start failed\n' >&2`,
    `exec "$node" "$mcp"`,
  ].join('\n');
}

function resolveBundledMcp() {
  const home = os.homedir();
  const candidates = [path.join(home, '.wallaby', 'mcp')];
  const cliDir = path.join(home, '.wallaby', 'cli');
  let dirs = [];
  try {
    dirs = fs.readdirSync(cliDir);
  } catch {}
  for (const d of dirs.sort()) {
    if (/^wallaby[0-9a-f]+$/.test(d)) candidates.push(path.join(cliDir, d, 'mcp', 'index.js'));
  }
  return candidates.find((f) => fs.existsSync(f));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function status() {
  const res = spawnSync(process.execPath, [manager, 'status', fixtureDir], { encoding: 'utf8' });
  return res.stdout.trim();
}

// Clean slate.
spawnSync(process.execPath, [manager, 'stop', fixtureDir], { stdio: 'ignore' });
await sleep(1500);

// 1. Spawn the launcher detached (new session/process group), like Zed.
const launcher = spawn('sh', ['-c', launcherScript()], {
  cwd: fixtureDir,
  detached: true, // setsid: pgid == launcher.pid
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, WALLABY_MANAGER: manager },
});

let mcpStarted = false;
launcher.stdout.on('data', () => { mcpStarted = true; }); // MCP protocol bytes = server started

// 2. Wait for auto-start to bring Wallaby up.
const deadline = Date.now() + 60_000;
let current = 'stopped';
while (Date.now() < deadline && current !== 'running') {
  current = await status();
  if (current.startsWith('running')) break;
  await sleep(1000);
}
console.log(`auto-stop check: after launcher start, Wallaby status = "${current}"`);
assert.ok(current.startsWith('running'), 'auto-start did not bring Wallaby up');

// 3. Teardown: killpg(launcher.pid), exactly what Zed does on removal.
try {
  process.kill(-launcher.pid, 'SIGKILL');
  console.log(`auto-stop check: group-killed launcher (pgid ${launcher.pid})`);
} catch (err) {
  launcher.kill('SIGKILL');
  throw new Error(`killpg failed: ${err.message}`);
}

// 4. Wallaby must be gone (it ran in the same process group).
await sleep(3000);
const after = await status();
console.log(`auto-stop check: after teardown, Wallaby status = "${after}"`);
assert.strictEqual(after, 'stopped', 'Wallaby survived the context-server teardown');
console.log('auto-stop check: OK — Wallaby starts with the server and stops with it.');