/* PR #10916 verification driver (untracked; lives in the verify worktree only). */
import { TerminalCapture } from './pr10916-capture.js';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';

const [arm, scen, outDir, mode] = process.argv.slice(2);
const H = '/root/verify/pr10916/harness';
rmSync(outDir, { recursive: true, force: true });
const ws = `${outDir}/ws`;
const home = `${outDir}/home`;
mkdirSync(ws, { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(`${ws}/README.md`, '# demo project\nNot a git checkout.\n');
const reqLog = `${outDir}/requests.jsonl`;
const fake = spawn('node', [`${H}/fake-model.mjs`, `${H}/${scen}.mjs`, reqLog], { env: { ...process.env, WS: ws } });
const url: string = await new Promise((res) => {
  let buf = '';
  fake.stdout.on('data', (d) => { buf += d; const m = buf.match(/FAKE_SERVER_READY (\S+)/); if (m) res(m[1]); });
});
const reqs = () => (existsSync(reqLog) ? readFileSync(reqLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const env: Record<string, string> = {
  PATH: process.env.PATH!, HOME: home, USERPROFILE: home, TERM: 'xterm-256color', FORCE_COLOR: '1',
  QWEN_SANDBOX: 'false', QWEN_CODE_NO_RELAUNCH: '1', NODE_NO_WARNINGS: '1', WS: ws, LANG: 'en_US.UTF-8',
};
const t = await TerminalCapture.create({ cols: 110, rows: 44, cwd: ws, env, theme: 'github-dark' as any, chrome: false, outputDir: outDir });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (fn: () => boolean | Promise<boolean>, ms = 60000) => { const s = Date.now(); while (Date.now() - s < ms) { if (await fn()) return true; await sleep(200); } return false; };
const screen = () => t.getScreenText();
await t.spawn('node', [`/root/verify/pr10916/${arm}/scripts/cli-entry.js`, '--approval-mode', 'yolo', '--auth-type', 'openai', '--openai-api-key', 'dummy', '--openai-base-url', url, '--model', 'fake-model']);
await t.waitFor('Type your message', { timeout: 60000 });
await t.idle(800, 8000);
await t.type('Figure out the git remote and recent history of this project.');
await t.idle(400, 4000);
await t.type('\n');
const result: Record<string, unknown> = { arm, scen };
if (mode === 'steer') {
  // wait until the model has been asked for step 4 (the slow git call), then steer mid-execution
  await until(() => reqs().some((r) => r.kind === 'main' && r.step >= 4), 60000);
  await sleep(2000);
  await t.type('STEER-MARKER-42: stop poking git, just summarize the README instead.');
  await t.idle(300, 3000);
  await t.type('\n');
  await t.idle(500, 3000);
  await t.capture('01-steer-queued.png');
}
const ended = await until(async () => { const s = await screen(); return s.includes('A potential loop was detected') || s.includes('DONE:') || s.includes('ACK:'); }, 90000);
await t.idle(800, 6000);
result.ended = ended;
await t.capture('02-end.png');
await t.captureFull('02-end-full.png');
result.screenAtEnd = await screen();
if ((await screen()).includes('A potential loop was detected')) {
  result.dialog = true;
  const before = reqs().length;
  await t.type('\r'); // "Keep loop detection enabled"
  await until(() => reqs().length > before, 15000);
  await t.idle(1500, 15000);
  await t.capture('03-after-dialog.png');
  await t.captureFull('03-after-dialog-full.png');
  result.requestsAfterDialog = reqs().length - before;
  if (mode === 'steer') {
    // Ask one follow-up so the history the model now holds is on the wire.
    await until(async () => (await screen()).includes('Type your message'), 20000);
    await t.idle(800, 8000);
    const b2 = reqs().length;
    await t.type('FOLLOWUP-QUESTION: what did I ask you mid-turn?');
    await t.idle(400, 4000);
    await t.type('\n');
    await until(() => reqs().some((r, i) => i >= b2 && JSON.stringify(r.messages).includes('FOLLOWUP-QUESTION')), 20000);
    await until(async () => (await screen()).includes('ACK-FOLLOWUP'), 20000);
    await t.idle(800, 6000);
    await t.capture('04-followup.png');
    const fr = reqs().find((r, i) => i >= b2 && r.kind === 'main' && JSON.stringify(r.messages).includes('FOLLOWUP-QUESTION'));
    result.followupMarkerCount = fr ? (JSON.stringify(fr.messages).match(/STEER-MARKER-42/g) || []).length : null;
  }
}
result.screenFinal = await screen();
const all = reqs();
result.requests = all.length;
result.main = all.filter((r) => r.kind === 'main').length;
result.markerCountPerRequest = all.map((r) => (JSON.stringify(r.messages).match(/STEER-MARKER-42/g) || []).length);
writeFileSync(`${outDir}/result.json`, JSON.stringify(result, null, 2));
await t.close();
fake.kill();
console.log(JSON.stringify({ arm, scen, ended, dialog: result.dialog ?? false, requests: result.requests, markers: result.markerCountPerRequest, followupMarkerCount: result.followupMarkerCount }));
process.exit(0);
