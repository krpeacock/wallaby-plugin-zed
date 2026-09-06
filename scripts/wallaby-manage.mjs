#!/usr/bin/env node
// Manages a headless Wallaby instance for a project.
//
// Used by the Zed extension launcher so the Wallaby MCP server has a live
// instance to connect to (auto-start), and stopped together with the context
// server (auto-stop via the caller's process group).
//
// Usage:
//   node wallaby-manage.js start  <projectRoot>
//   node wallaby-manage.js stop   <projectRoot>
//   node wallaby-manage.js status <projectRoot>   # prints "running:<port>" | "stopped"
//
// Design notes:
// - "start" spawns `wallaby` as a NON-detached child: it stays in the caller's
//   process group. Zed launches the context server in its own session/group
//   and group-kills it on teardown, so Wallaby stops together with the MCP
//   server. `child.unref()` only drops the parent's event-loop reference; it
//   does NOT change the process group.
// - "start" is idempotent: if a Wallaby instance is already registered for the
//   project (via ~/.wallaby/registry), it is reused instead of starting another.
// - "stop" only touches instances registered for the given project, so a
//   Wallaby you started yourself (IDE, another tool) is never killed.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const REGISTRY_DIR = path.join(os.homedir(), '.wallaby', 'registry');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

function instancesFor(project) {
  const matches = [];
  let files = [];
  try {
    files = fs.readdirSync(REGISTRY_DIR).filter((f) => f.endsWith('.json'));
  } catch {}
  const needle = path.resolve(project).toLowerCase();
  for (const file of files) {
    try {
      const reg = JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, file), 'utf8'));
      const config = String(reg.paths?.config || '').toLowerCase();
      if (config.includes(needle)) matches.push(reg);
    } catch {}
  }
  return matches;
}

async function runningPort(project) {
  for (const reg of instancesFor(project)) {
    const port = reg.ports?.primary;
    if (port && (await portOpen(port))) return port;
  }
  return null;
}

async function start(project) {
  const existing = await runningPort(project);
  if (existing) {
    console.log(`wallaby-manage: reusing running Wallaby (port ${existing}) for ${project}`);
    return 0;
  }

  console.log(`wallaby-manage: starting headless Wallaby for ${project}`);
  const child = spawn(process.env.WALLABY_CLI || 'wallaby', ['--ui=false'], {
    cwd: project,
    stdio: 'ignore',
  });
  // Keep the child in our process group so the context server's teardown
  // group-kill reaches it. unref() just lets THIS process exit while it runs.
  child.unref();
  child.on('error', (err) => {
    console.error(`wallaby-manage: failed to start wallaby: ${err.message}`);
    process.exit(1);
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const port = await runningPort(project);
    if (port) {
      console.log(`wallaby-manage: Wallaby is running (port ${port})`);
      return 0;
    }
    await sleep(1000);
  }
  console.error('wallaby-manage: Wallaby did not become ready within 30s');
  return 1;
}

async function stop(project) {
  const instances = instancesFor(project);
  if (!instances.length) {
    console.log(`wallaby-manage: no Wallaby instance registered for ${project}`);
    return 0;
  }
  for (const reg of instances) {
    for (const pid of Object.values(reg.pids || {})) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`wallaby-manage: stopping Wallaby pid ${pid}`);
      } catch {}
    }
  }
  await sleep(1500);
  for (const reg of instances) {
    for (const pid of Object.values(reg.pids || {})) {
      try {
        process.kill(pid, 0); // still alive?
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
  }
  return 0;
}

async function status(project) {
  const port = await runningPort(project);
  console.log(port ? `running:${port}` : 'stopped');
  return 0;
}

const [command, project] = process.argv.slice(2);
if (!command || !project) {
  console.error('usage: wallaby-manage.js <start|stop|status> <projectRoot>');
  process.exit(1);
}
const fn = { start, stop, status }[command];
if (!fn) {
  console.error(`wallaby-manage: unknown command '${command}'`);
  process.exit(1);
}
fn(path.resolve(project)).then(
  (code) => process.exit(code),
  (err) => {
    console.error('wallaby-manage:', err);
    process.exit(1);
  }
);