// A/B arm for R2: the same build.sh + prompt + model through the ORDINARY
// (non-Hosted) Shell tool of the same bundle, headless -p.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';

const MODEL = process.env.REAL_MODEL ?? 'qwen3.8-max';
const trial = process.argv[2] ?? '1';
L.openLog(`s4-ordinary-cli-${trial}`);
const root = path.join(L.RIG, 'run', `ordinary-${trial}`);
fs.rmSync(root, { recursive: true, force: true });
const work = path.join(root, 'work');
const home = path.join(root, 'home');
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(path.join(home, '.qwen'), { recursive: true });
fs.writeFileSync(`${work}/build.sh`, [
  '#!/bin/sh',
  'echo run >> runs.log',
  'i=1',
  'while [ $i -le 600 ]; do echo "compiling module $i ... ok (cache warm, 0 warnings)"; i=$((i+1)); done',
  'echo "ERROR: undefined symbol foo_bar referenced from module 417" >&2',
  'echo "BUILD FAILED after 600 modules"',
  'exit 3',
  '',
].join('\n'));
const real = JSON.parse(fs.readFileSync(`${process.env.HOME}/.qwen/settings.json`, 'utf8'));
const provider = real.modelProviders.openai.find((p) => p.id === MODEL);
fs.writeFileSync(path.join(home, '.qwen', 'settings.json'), JSON.stringify({
  security: { auth: { selectedType: 'openai' } },
  model: { name: MODEL },
  telemetry: { enabled: false },
  modelProviders: { openai: [{ id: provider.id, envKey: provider.envKey, baseUrl: provider.baseUrl }] },
}));
const t0 = Date.now();
let out = '';
try {
  out = execFileSync(L.NODE22, [path.join(L.SP, 'wt-pr', 'dist', 'cli.js'), '-p', 'Run `sh build.sh` in the workspace with the shell tool. Then tell me the exact ERROR line it printed and the exit code.', '--approval-mode', 'yolo', '--output-format', 'stream-json'], {
    cwd: work, encoding: 'utf8', timeout: 240000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: home, QWEN_HOME: path.join(home, '.qwen'), [provider.envKey]: real.env[provider.envKey], QWEN_SANDBOX: 'false', NO_COLOR: '1' },
  });
} catch (e) {
  out = (e.stdout ?? '') + (e.stderr ?? '');
  L.say('cli', `exit=${e.status}`);
}
const calls = [];
let final = '';
for (const line of out.split('\n')) {
  let ev;
  try { ev = JSON.parse(line); } catch { continue; }
  for (const c of ev.message?.content ?? []) {
    if (c.type === 'tool_use') calls.push(`call ${c.name}(${JSON.stringify(c.input).slice(0, 100)})`);
    if (c.type === 'tool_result') {
      const text = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
      calls.push(`result bytes=${Buffer.byteLength(text)} hasERROR=${text.includes('ERROR: undefined symbol')} hasExit3=${/Exit Code: 3/.test(text)}`);
    }
  }
  if (ev.type === 'result') final = ev.result ?? '';
}
L.say('ordinary', `model=${MODEL} ${Date.now() - t0}ms`);
for (const c of calls) L.say('ordinary tool', c);
L.say('ordinary text', final.replace(/\s+/g, ' ').slice(0, 300));
L.say('ordinary fs', `runs.log lines=${fs.existsSync(`${work}/runs.log`) ? fs.readFileSync(`${work}/runs.log`, 'utf8').trim().split('\n').length : 0}`);
