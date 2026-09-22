// Real `qwen serve --channel github` against fake-github + scripted model.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const RUNS = '/root/verify/pr12475-runs/github';
const GH = 'http://127.0.0.1:28190';
const ARMS = { base: '/root/verify/pr12475-base', head: '/root/verify/pr12475-head', fix: '/root/verify/pr12475-fix' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const onlyArms = process.argv[2]?.split(',') ?? ['base', 'head'];
const only = process.argv[3]?.split(',');
const BASE_CH = { type: 'github', token: 'ghp_harness', baseUrl: GH, pollInterval: 800, groupPolicy: 'open', senderPolicy: 'allowlist', allowedUsers: ['maintainer'], approvalMode: 'yolo' };
const SCENARIOS = [
  { id: 'G0', title: 'control: senderPolicy allowlist, allowedUsers ["Alice"] (mixed case)', cfg: { allowedUsers: ['Alice'] }, probes: ['Alice'] },
  { id: 'G1', title: 'groupSenderPolicy allowlist, allowedGroupUsers ["Alice"] (mixed case)', cfg: { groupSenderPolicy: 'allowlist', allowedGroupUsers: ['Alice'] }, probes: ['Alice'] },
  { id: 'G2', title: 'groupSenderPolicy allowlist, allowedGroupUsers ["alice"] (lower case)', cfg: { groupSenderPolicy: 'allowlist', allowedGroupUsers: ['alice'] }, probes: ['Alice'] },
  { id: 'G3', title: 'groupSenderPolicy open (every GitHub thread is a group)', cfg: { groupSenderPolicy: 'open' }, probes: ['stranger'] },
  { id: 'G4', title: 'aggregate lane (reason=comment, no mention), groupSenderPolicy open', cfg: { groupSenderPolicy: 'open' }, probes: ['stranger'], reason: 'comment' },
  { id: 'G5', title: 'aggregate lane (reason=comment, no mention), keys absent', cfg: {}, probes: ['stranger'], reason: 'comment' },
];
async function run(arm, sc) {
  const dir = path.join(RUNS, arm, sc.id); fs.rmSync(dir, { recursive: true, force: true });
  const home = path.join(dir, 'home'); const ws = path.join(dir, 'workspace'); fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ general: { language: 'en' }, security: { auth: { selectedType: 'openai' }, folderTrust: { enabled: false } }, privacy: { usageStatisticsEnabled: false }, channels: { github: { ...BASE_CH, cwd: ws, ...sc.cfg } }, $version: 4 }, null, 2));
  await fetch(`${GH}/__reset`);
  const logFile = path.join(dir, 'daemon.log'); const out = fs.openSync(logFile, 'w');
  const proc = spawn(process.execPath, [path.join(ARMS[arm], 'dist/cli.js'), 'serve', '--hostname', '127.0.0.1', '--port', '28199', '--no-web', '--channel', 'github'], { cwd: ws, stdio: ['ignore', out, out], detached: true,
    env: { ...process.env, QWEN_HOME: home, OPENAI_BASE_URL: 'http://127.0.0.1:28090/v1', OPENAI_API_KEY: 'harness-key', OPENAI_MODEL: 'harness-model', NO_PROXY: '*', no_proxy: '*', HTTPS_PROXY: '', HTTP_PROXY: '', https_proxy: '', http_proxy: '' } });
  const end = Date.now() + 60000; let started = false;
  while (Date.now() < end) { if (/authenticated as/.test(fs.readFileSync(logFile, 'utf8'))) { started = true; break; } if (proc.exitCode !== null) break; await sleep(300); }
  const result = { arm, id: sc.id, title: sc.title, cfg: sc.cfg, started, probes: [] };
  if (started) {
    await sleep(2500);
    let i = 0;
    for (const login of sc.probes) {
      i++; const token = `T-${sc.id}-${i}-${login}`;
      await fetch(`${GH}/__inject`, { method: 'POST', body: JSON.stringify({ login, reason: sc.reason, body: sc.reason === 'comment' ? `${token} drive-by note, no mention` : `@qwen-bot ${token} please take a look` }) });
      let verdict = 'NO_REPLY'; const dl = Date.now() + 15000;
      while (Date.now() < dl) { await sleep(400); const r = await (await fetch(`${GH}/__replies`)).json(); if (JSON.stringify(r).includes(`ANSWER ${token}`)) { verdict = 'ANSWERED'; break; } }
      const log = fs.readFileSync(logFile, 'utf8');
      result.probes.push({ login, token, verdict, listCommentsCalls: (fs.readFileSync(path.join(RUNS, 'shared/gh-api.jsonl'), 'utf8').match(/issues\/1\/comments","query":"\?since/g) || []).length, logHints: log.split('\n').filter((l) => /preflight|sender|allowlist|github/i.test(l) && /Channel:github/.test(l)).slice(-4) });
    }
  } else result.log = fs.readFileSync(logFile, 'utf8').split('\n').filter((l) => /error|fail/i.test(l)).slice(0, 6);
  try { process.kill(-proc.pid, 'SIGTERM'); } catch {}
  const e2 = Date.now() + 10000; while (proc.exitCode === null && Date.now() < e2) await sleep(200);
  if (proc.exitCode === null) { try { process.kill(-proc.pid, 'SIGKILL'); } catch {} }
  return result;
}
const results = [];
for (const sc of SCENARIOS) { if (only && !only.includes(sc.id)) continue; for (const arm of onlyArms) { const r = await run(arm, sc); results.push(r); console.log(`${arm.padEnd(4)} ${sc.id} started=${r.started} ` + r.probes.map((p) => `${p.login}=${p.verdict}`).join(' '), r.log ? r.log.join(' | ') : ''); } }
fs.writeFileSync(path.join(RUNS, `results-${onlyArms.join('_')}-${Date.now()}.json`), JSON.stringify(results, null, 2));
