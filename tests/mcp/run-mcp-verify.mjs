// Orchestrates the MCP verification run on the fixture project:
//   1. activate a Wallaby license from the repo `.env`, if provided
//   2. ensure a single Wallaby instance is running on tests/mcp
//   3. wait for it to report the fixture tests
//   4. run the verify-mcp.mjs node:test suite
//   5. stop the Wallaby instance we started (cleanup)
//
// Usage: npm run verify   (from tests/mcp)

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(fixtureDir, '..', '..');
const registryDir = path.join(os.homedir(), '.wallaby', 'registry');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portOpen(port) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (open) => {
      sock.destroy();
      resolve(open);
    };
    sock.setTimeout(500);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
    sock.connect(port, '0.0.0.0');
  });
}

// Wallaby registers each running instance in ~/.wallaby/registry/*.json with
// its config path; find ones that belong to this fixture.
function wallabyInstancesForFixture() {
  const matches = [];
  let files = [];
  try {
    files = fs.readdirSync(registryDir).filter((f) => f.endsWith('.json'));
  } catch {}
  const fixture = fixtureDir.toLowerCase();
  for (const file of files) {
    try {
      const reg = JSON.parse(fs.readFileSync(path.join(registryDir, file), 'utf8'));
      const config = (reg.paths?.config || '').toLowerCase();
      if (config.includes(fixture)) matches.push(reg);
    } catch {}
  }
  return matches;
}

function stopInstancesForFixture() {
  for (const reg of wallabyInstancesForFixture()) {
    for (const pid of Object.values(reg.pids || {})) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`run-mcp-verify: stopped Wallaby core pid ${pid} (fixture instance)`);
      } catch {}
    }
  }
}

async function wallabyIsReady() {
  for (const reg of wallabyInstancesForFixture()) {
    const port = reg.ports?.primary;
    if (port && (await portOpen(port))) return true;
  }
  return false;
}

function runVerifyTests() {
  return new Promise((resolve) => {
    const child = spawn('node', ['--test', 'verify-mcp.mjs'], {
      cwd: fixtureDir,
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

// --- 1. license -----------------------------------------------------------
console.log('run-mcp-verify: activating license (if provided in repo .env)…');
{
  const res = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'activate-wallaby-license.mjs')], {
    stdio: 'inherit',
  });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

// --- 2. ensure a fresh Wallaby instance on the fixture ----------------------
stopInstancesForFixture();
await sleep(1500);

console.log('run-mcp-verify: starting Wallaby on the fixture…');
const wallaby = spawn('wallaby', ['--ui=false'], {
  cwd: fixtureDir,
  stdio: 'ignore',
  detached: true,
});
wallaby.unref();

const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  if (await wallabyIsReady()) break;
  await sleep(2000);
}
if (!(await wallabyIsReady())) {
  console.error('run-mcp-verify: Wallaby did not start within 90s (see ~/.wallaby/logs).');
  process.exit(1);
}
console.log('run-mcp-verify: Wallaby is running on the fixture.');

// --- 3. run the MCP test suite ----------------------------------------------
const code = await runVerifyTests();

// --- 4. cleanup --------------------------------------------------------------
stopInstancesForFixture();
process.exit(code);