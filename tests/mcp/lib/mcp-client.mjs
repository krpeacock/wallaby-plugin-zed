// Minimal stdio MCP client used by the Wallaby MCP verifier.
// Talks JSON-RPC to the Wallaby MCP server exactly like Zed's agent does.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Locate the Wallaby MCP server entry point, mirroring the extension's
// RESOLVE_SCRIPT: explicit override -> ~/.wallaby/mcp -> newest bundled
// ~/.wallaby/cli/<hash>/mcp/index.js.
export function locateMcpServer() {
  const candidates = [];
  if (process.env.WALLABY_MCP) candidates.push(process.env.WALLABY_MCP);
  candidates.push(path.join(os.homedir(), '.wallaby', 'mcp'));
  const cliDir = path.join(os.homedir(), '.wallaby', 'cli');
  let dirs = [];
  try {
    dirs = fs.readdirSync(cliDir);
  } catch {}
  for (const dir of dirs.sort()) {
    if (/^wallaby[0-9a-f]+$/.test(dir)) {
      candidates.push(path.join(cliDir, dir, 'mcp', 'index.js'));
    }
  }
  return candidates.find((f) => fs.existsSync(f)) || null;
}

export class McpClient {
  constructor(serverPath) {
    this.serverPath = serverPath;
    this.child = null;
    this.buf = '';
    this.nextId = 1;
    this.pending = new Map();
  }

  start() {
    return new Promise((resolve, reject) => {
      const child = spawn(process.env.WALLABY_NODE || 'node', [this.serverPath], {
        stdio: ['pipe', 'pipe', 'inherit'],
      });
      this.child = child;
      child.on('error', reject);
      child.stdout.on('data', (chunk) => {
        this.buf += chunk.toString();
        let idx;
        while ((idx = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, idx);
          this.buf = this.buf.slice(idx + 1);
          if (!line.trim()) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.id != null && this.pending.has(msg.id)) {
            const { resolve: ok, reject: fail } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) fail(new Error(msg.error.message || JSON.stringify(msg.error)));
            else ok(msg.result);
          }
        }
      });
      this.call('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'wallaby-zed-verify', version: '0.1.0' },
      })
        .then(() => {
          this.child.stdin.write('\n'); // notifications/initialized
          resolve();
        })
        .catch(reject);
    });
  }

  call(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  async toolsList() {
    return this.call('tools/list', {});
  }

  async callTool(name, args = {}) {
    return this.call('tools/call', { name, arguments: args });
  }

  close() {
    try {
      this.child?.kill();
    } catch {}
  }
}