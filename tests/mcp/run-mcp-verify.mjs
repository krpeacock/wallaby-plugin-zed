// Orchestrates the MCP verification run on the fixture project, going through
// the exact scripts the Zed extension uses:
//   1. activate a Wallaby license from the repo `.env`, if provided
//   2. `wallaby-manage.js stop`  - clean slate (only fixture instances)
//   3. `wallaby-manage.js start` - the auto-start feature under test
//   4. run the verify-mcp.mjs node:test suite
//   5. `wallaby-manage.js stop`  - cleanup
//
// Usage: npm run verify   (from tests/mcp)

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(fixtureDir, '..', '..');
const manager = path.join(repoRoot, 'scripts', 'wallaby-manage.mjs');
const activator = path.join(repoRoot, 'scripts', 'activate-wallaby-license.mjs');

function runNode(args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', ...opts });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function managerCmd(command) {
  const code = await runNode([manager, command, fixtureDir]);
  if (code !== 0) {
    console.error(`run-mcp-verify: wallaby-manage ${command} failed (code ${code})`);
    process.exit(code);
  }
}

// --- 1. license --------------------------------------------------------------
console.log('run-mcp-verify: activating license (if provided in repo .env)…');
const licenseCode = await runNode([activator]);
if (licenseCode !== 0) process.exit(licenseCode);

// --- 2/3. stop then start via the extension's own manager ----------------------
await managerCmd('stop');
console.log('run-mcp-verify: auto-starting Wallaby (feature under test)…');
await managerCmd('start');

// --- 4. run the MCP test suite -------------------------------------------------
const code = await runNode(['--test', 'verify-mcp.mjs'], { cwd: fixtureDir });

// --- 5. cleanup -----------------------------------------------------------------
await managerCmd('stop');
process.exit(code);