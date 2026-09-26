// usage: node rig12500/run-headless.mjs <arm> <tag> <cliPath> <faultPortFile> <modelPortFile> [prompt]
// Runs the real bundled CLI headless with the full status matrix configured, in an isolated
// QWEN_HOME / QWEN_RUNTIME_DIR, and records stdout / stderr / debug log.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as M from './matrix.mjs';
const MATRIX = M[process.env.MATRIX_NAME || 'MATRIX'];
const { mcpServers } = M;

const [arm, tag, cli, faultPortFile, modelPortFile, prompt = `CALL:mcp__${MATRIX[0].name}__probe`] = process.argv.slice(2);
const R = '/Users/wenshao/git/rig12500-run';
const port = fs.readFileSync(faultPortFile, 'utf8').trim();
const modelPort = fs.readFileSync(modelPortFile, 'utf8').trim();
const home = `${R}/home-${arm}-${tag}`;
const rt = `${R}/rt-${arm}-${tag}`;
fs.rmSync(home, { recursive: true, force: true });
fs.rmSync(rt, { recursive: true, force: true });
fs.mkdirSync(home, { recursive: true });
fs.writeFileSync(
  `${home}/settings.json`,
  JSON.stringify(
    {
      mcpServers: mcpServers(port, MATRIX),
      security: { auth: { selectedType: 'openai' } },
      general: { enableAutoUpdate: false },
    },
    null,
    1,
  ),
);
const t0 = Date.now();
const r = spawnSync(
  process.execPath,
  [cli, '-p', prompt, '--approval-mode', 'yolo', '--auth-type', 'openai', '--openai-api-key', 'dummy',
    '--openai-base-url', `http://127.0.0.1:${modelPort}/v1`, '--model', 'dummy'],
  {
    cwd: `${R}/ws`,
    encoding: 'utf8',
    timeout: 240000,
    env: {
      HOME: process.env.HOME,
      PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
      NO_PROXY: '*',
      QWEN_HOME: home,
      QWEN_RUNTIME_DIR: rt,
      QWEN_DEBUG_LOG_FILE: '1',
      NODE_NO_WARNINGS: '1',
    },
  },
);
const ms = Date.now() - t0;
fs.writeFileSync(`${R}/out-${arm}-${tag}.txt`, r.stdout ?? '');
fs.writeFileSync(`${R}/err-${arm}-${tag}.txt`, r.stderr ?? '');
const warn = (r.stderr ?? '').split('\n').find((l) => l.includes('failed to start')) ?? '';
const failed = /failed to start: ([^.]*)\./.exec(warn)?.[1]?.split(', ').filter(Boolean) ?? [];
let debug = [];
const dd = `${rt}/debug`;
if (fs.existsSync(dd))
  debug = fs.readdirSync(dd).filter((f) => f !== 'latest' && f.endsWith('.txt')).flatMap((f) => fs.readFileSync(`${dd}/${f}`, 'utf8').split('\n'));
const mcpErr = {};
for (const l of debug) {
  const m = /MCP ERROR \(([^)]+)\):?\s*(.*)$/.exec(l);
  if (m) (mcpErr[m[1]] ??= []).push(m[2].slice(0, 200));
}
const summary = { arm, tag, exit: r.status, signal: r.signal, ms, stdout: (r.stdout ?? '').trim().slice(0, 300), failed, mcpErr };
fs.writeFileSync(`${R}/summary-${arm}-${tag}.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ arm, tag, exit: r.status, ms, stdout: summary.stdout, failedCount: failed.length, failed }, null, 0));
