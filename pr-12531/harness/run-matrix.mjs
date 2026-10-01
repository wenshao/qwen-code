// Real-CLI matrix for PR #12531: real stdio MCP servers + scripted fake model + real `qwen -p`.
// usage: ARMS_SEL=base,head,fix node run-matrix.mjs <outDir> [scenarioId...]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ARMS, SCENARIOS, reg, setupRun, startFake, cleanEnv, resolveList } from './scenarios.mjs';

const outDir = path.resolve(process.argv[2] ?? 'out');
const only = process.argv.slice(3);
const sel = (process.env.ARMS_SEL ?? 'base,head').split(',');
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
  if (/Matching deny rule|denied by permission rules/i.test(toolResult)) return 'DENY-RULE';
  if (/non-interactive mode cannot prompt/i.test(toolResult)) return 'ASK';
  if (/not found|unknown tool/i.test(toolResult)) return 'NOT_REGISTERED';
  return 'OTHER';
}

const results = [];
for (const sc of SCENARIOS) {
  if (only.length && !only.includes(sc.id)) continue;
  const target = reg(...sc.target);
  for (const arm of sel) {
    const dir = ARMS[arm];
    const run = path.join(outDir, sc.id, arm);
    const { home, ws, hits, modelLog } = setupRun(sc, run);
    const fake = await startFake(modelLog, target);
    const args = [`${dir}/scripts/cli-entry.js`, '-p', 'VERIFY-PR12531: call the tool', '--approval-mode', sc.mode,
      '--auth-type', 'openai', '--openai-api-key', 'dummy', '--openai-base-url', fake.url, '--model', 'dummy'];
    const env = { ...cleanEnv, HOME: home, USERPROFILE: home, QWEN_SANDBOX: 'false', QWEN_CODE_NO_RELAUNCH: '1', NO_PROXY: '127.0.0.1,localhost' };
    const t0 = Date.now();
    const r = await runOnce(process.execPath, args, { cwd: ws, env }, 180_000);
    fake.proc.kill();
    const hitLines = fs.readFileSync(hits, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const modelLines = fs.existsSync(modelLog) ? fs.readFileSync(modelLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const toolResult = modelLines.flatMap((m) => m.toolResults).at(-1) ?? '';
    const executed = hitLines.some((h) => h.server === sc.target[0] && h.tool === sc.target[1]);
    const verdict = classify(executed, toolResult);
    const row = { id: sc.id, arm, title: sc.title, mode: sc.mode, allow: resolveList(sc.allow), deny: resolveList(sc.deny), target,
      executed, hits: hitLines.length, verdict, toolResult: toolResult.slice(0, 300), exit: r.code, ms: Date.now() - t0 };
    fs.writeFileSync(path.join(run, 'cli.stdout.txt'), r.out);
    fs.writeFileSync(path.join(run, 'cli.stderr.txt'), r.err);
    fs.writeFileSync(path.join(run, 'row.json'), JSON.stringify(row, null, 2));
    results.push(row);
    console.log(`${sc.id.padEnd(4)} ${arm.padEnd(4)} ${verdict.padEnd(10)} exit=${r.code} | ${toolResult.slice(0, 150).replace(/\n/g, ' ')}`);
  }
}
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
