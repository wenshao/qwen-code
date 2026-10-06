// Real-CLI matrix for PR #12531: real stdio MCP servers + scripted fake model + real `qwen -p`.
// usage: ARMS_SEL=base,head,candA,candC CONC=4 node run-matrix.mjs <outDir> [scenarioId|group:X ...]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ARMS, SCENARIOS, reg, setupRun, startFake, cleanEnv, resolveList } from './scenarios.mjs';

const outDir = path.resolve(process.argv[2] ?? 'out');
const only = process.argv.slice(3);
const sel = (process.env.ARMS_SEL ?? 'base,head').split(',');
const CONC = Number(process.env.CONC ?? 4);
fs.mkdirSync(outDir, { recursive: true });

function runOnce(cmd, args, opts, timeoutMs) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('exit', (code, sig) => { clearTimeout(t); resolve({ code, sig, out, err }); });
  });
}

export function classify(executed, toolResult) {
  if (executed) return 'EXECUTED';
  if (/deny rule|denied by permission|disabled by permission|is disabled/i.test(toolResult)) return 'DENY-RULE';
  if (/non-interactive mode cannot prompt|requires (user )?(confirmation|approval)|cannot prompt/i.test(toolResult)) return 'ASK';
  if (/not found|unknown tool|not available|isn't available|is not allowed|not in the|no such tool/i.test(toolResult)) return 'NOT-AVAILABLE';
  return 'OTHER';
}

const jobs = [];
for (const sc of SCENARIOS) {
  if (only.length && !only.some((o) => o === sc.id || o === `group:${sc.group}`)) continue;
  for (const arm of sel) jobs.push({ sc, arm });
}

async function runJob({ sc, arm }) {
  const target = reg(...sc.target);
  const dir = ARMS[arm];
  const run = path.join(outDir, sc.id, arm);
  const { home, ws, hits, modelLog, settings } = setupRun(sc, run);
  const fake = await startFake(modelLog, target, sc.agent ? 'agent' : 'direct');
  const args = [`${dir}/scripts/cli-entry.js`, '-p', 'VERIFY-PR12531: call the tool', '--approval-mode', sc.mode,
    '--auth-type', 'openai', '--openai-api-key', 'dummy', '--openai-base-url', fake.url, '--model', 'dummy'];
  const env = { ...cleanEnv, HOME: home, USERPROFILE: home, QWEN_SANDBOX: 'false', QWEN_CODE_NO_RELAUNCH: '1', NO_PROXY: '127.0.0.1,localhost' };
  const t0 = Date.now();
  const r = await runOnce(process.execPath, args, { cwd: ws, env }, 240_000);
  fake.proc.kill();
  const hitLines = fs.readFileSync(hits, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const modelLines = fs.existsSync(modelLog) ? fs.readFileSync(modelLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const resultRole = sc.agent ? 'sub' : 'main';
  const toolResult = modelLines.filter((m) => m.role === resultRole).flatMap((m) => m.toolResults).at(-1) ?? '';
  const subDeclared = sc.agent ? modelLines.filter((m) => m.role === 'sub').map((m) => m.targetDeclared).at(0) ?? null : null;
  const executed = hitLines.some((h) => h.server === sc.target[0] && h.tool === sc.target[1]);
  const verdict = classify(executed, toolResult);
  const row = { id: sc.id, group: sc.group, arm, title: sc.title, mode: sc.mode,
    trusted: Object.entries(sc.servers).filter(([, s]) => !Array.isArray(s) && s.trust).map(([k]) => k),
    allow: settings.permissions.allow, ask: settings.permissions.ask, deny: settings.permissions.deny,
    disallowedTools: sc.agent ? resolveList(sc.agent.disallowedTools) : undefined,
    target, executed, hits: hitLines.length, verdict, subTargetDeclared: subDeclared,
    toolResult: toolResult.slice(0, 400), exit: r.code, sig: r.sig, ms: Date.now() - t0 };
  fs.writeFileSync(path.join(run, 'cli.stdout.txt'), r.out);
  fs.writeFileSync(path.join(run, 'cli.stderr.txt'), r.err);
  fs.writeFileSync(path.join(run, 'row.json'), JSON.stringify(row, null, 2));
  console.log(`${sc.id.padEnd(4)} ${arm.padEnd(6)} ${verdict.padEnd(13)} exit=${r.code} ${((Date.now() - t0) / 1000).toFixed(0)}s${subDeclared === null ? '' : ` subDeclared=${subDeclared}`} | ${toolResult.slice(0, 140).replace(/\n/g, ' ')}`);
  return row;
}

const results = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(CONC, jobs.length) }, async () => {
  while (next < jobs.length) {
    const job = jobs[next++];
    try { results.push(await runJob(job)); }
    catch (e) { console.log(`${job.sc.id} ${job.arm} HARNESS-ERROR ${e.message}`); results.push({ id: job.sc.id, arm: job.arm, verdict: 'HARNESS-ERROR', error: String(e) }); }
  }
}));
const order = (r) => [SCENARIOS.findIndex((s) => s.id === r.id), sel.indexOf(r.arm)];
results.sort((a, b) => { const [x1, y1] = order(a), [x2, y2] = order(b); return x1 - x2 || y1 - y2; });
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
console.log(`wrote ${results.length} rows -> ${path.join(outDir, 'results.json')}`);
