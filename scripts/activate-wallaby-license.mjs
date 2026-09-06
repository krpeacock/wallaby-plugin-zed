#!/usr/bin/env node
// Accepts a Wallaby license provided via the repo `.env` (or environment) and
// activates the machine-local Wallaby install.
//
// Reads:
//   WALLABY_LICENSE        - the license key (required to activate)
//   WALLABY_LICENSE_EMAIL  - the registered email (optional; enables online
//                            license identity via ~/.wallaby/.ol)
//
// Writes (backing up any existing file first):
//   ~/.wallaby/key.lic     - the raw license key
//   ~/.wallaby/.ol         - base64 JSON { wallabyEmail } when email is given
//
// Format note: Wallaby reads key.lic by taking the content after the last ':'.
// Real keys are base64 blobs >= 50 chars; trial timestamps are short numbers.
// Existing running Wallaby cores must be restarted for the license to take
// effect (the verifier orchestrator handles this).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const fileEnv = loadDotEnv(path.join(repoRoot, '.env'));
const license = process.env.WALLABY_LICENSE || fileEnv.WALLABY_LICENSE || '';
const email = process.env.WALLABY_LICENSE_EMAIL || fileEnv.WALLABY_LICENSE_EMAIL || '';

const wallabyDir = path.join(os.homedir(), '.wallaby');
const keyFile = path.join(wallabyDir, 'key.lic');
const olFile = path.join(wallabyDir, '.ol');

if (!license) {
  console.log('activate-wallaby-license: no WALLABY_LICENSE in repo .env or environment; nothing to do.');
  process.exit(0);
}

if (license.length < 50) {
  console.error(
    `activate-wallaby-license: WALLABY_LICENSE looks too short (${license.length} chars) to be a Wallaby license key. ` +
      'Trial state is stored as a short timestamp; real keys are base64 blobs >= 50 chars.'
  );
  process.exit(1);
}

fs.mkdirSync(wallabyDir, { recursive: true });

if (fs.existsSync(keyFile) && !fs.existsSync(`${keyFile}.bak`)) {
  fs.copyFileSync(keyFile, `${keyFile}.bak`);
  console.log(`activate-wallaby-license: backed up existing ${path.basename(keyFile)} -> ${path.basename(keyFile)}.bak`);
}

const normalized = license.trim().endsWith('\n') ? license.trim() : license.trim() + '\n';
fs.writeFileSync(keyFile, normalized);
console.log(`activate-wallaby-license: wrote license key (${license.trim().length} chars) to ${keyFile}`);

if (email) {
  fs.writeFileSync(olFile, Buffer.from(JSON.stringify({ wallabyEmail: email.trim() })).toString('base64'));
  console.log(`activate-wallaby-license: wrote online license identity for ${email.trim()} to ${olFile}`);
}

// Best-effort sanity read: what will the core parse from the key?
try {
  const decoded = Buffer.from(license.trim().split(':').pop(), 'base64').toString('utf8');
  const [registeredTo] = decoded.split('\n');
  console.log(`activate-wallaby-license: key decodes as "${registeredTo || '(unparsable)'}"`);
} catch {
  console.log('activate-wallaby-license: could not decode key locally (Wallaby will validate on start).');
}

console.log('activate-wallaby-license: restart Wallaby for the license to take effect.');