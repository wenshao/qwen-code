// S3: /restore a JSON checkpoint written under default approval mode, then
// rewind to a turn inside the restored range. LEGACY=1 strips `promptIds`
// from the checkpoint first (a checkpoint written before this PR).
import { writeFileSync, readFileSync, readdirSync, existsSync, statSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import {
  ARM, setupRun, cliEnv, boot, send, doubleEsc, listFiles, userMarkers,
  isMain, TerminalCapture, startFake, msgText, type Req, type Reply,
} from './common.mjs';

const LEGACY = process.env.LEGACY === '1';
const { runDir, ws, home, shots } = await setupRun(LEGACY ? 's3legacy' : 's3');

function lastUserMarker(req: Req): string | undefined {
  for (let i = req.body.messages.length - 1; i >= 0; i--) {
    const m = req.body.messages[i]!;
    if (m.role !== 'user') continue;
    const mm = /\bT(\d+):/.exec(msgText(m));
    if (mm) return `T${mm[1]}`;
  }
  return undefined;
}
const fake = await startFake((req): Reply => {
  if (!isMain(req)) return { text: 'ok' };
  const last = req.body.messages.at(-1)!;
  const text = msgText(last);
  if (last.role === 'tool') return { text: `${lastUserMarker(req)} done.` };
  const f: Record<string, string> = { T1: 'a.txt', T2: 'b.txt', T3: 'c.txt' };
  const m = /\bT(\d+):/.exec(text);
  if (!m) return { text: 'ok' };
  const k = `T${m[1]}`;
  if (f[k]) return { toolCalls: [{ name: 'write_file', args: { file_path: join(ws, f[k]!), content: `${k}\n` } }] };
  const seen = userMarkers(req).filter((x) => x !== k);
  return { text: `CONTEXT CHECK -> user prompts I still see: [${seen.join(', ')}]` };
});

function findDir(root: string, name: string): string | undefined {
  if (!existsSync(root)) return undefined;
  for (const e of readdirSync(root)) {
    const p = join(root, e);
    if (!statSync(p).isDirectory()) continue;
    if (e === name) return p;
    const r = findDir(p, name);
    if (r) return r;
  }
  return undefined;
}

const t = await TerminalCapture.create({ cols: 110, rows: 46, cwd: ws, env: cliEnv(home), theme: 'github-dark' as any, chrome: false, outputDir: shots });
const log: Record<string, unknown> = { arm: ARM, legacy: LEGACY };
async function approveUntil(done: string, since: number) {
  const deadline = Date.now() + 40000;
  let approvals = 0;
  while (Date.now() < deadline) {
    const tail = t.raw.slice(since);
    if (tail.includes(done)) return approvals;
    const pending = (tail.match(/Yes, allow once/g) ?? []).length;
    if (pending > approvals) {
      await t.idle(400, 3000);
      await t.type('\r');
      approvals++;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timeout waiting for ${done}`);
}
try {
  await boot(t, fake.baseUrl, ['--approval-mode', 'default']);
  for (const k of ['T1', 'T2', 'T3']) {
    const mark = t.outputLength;
    await send(t, `${k}: write the ${k} file`);
    await approveUntil(`${k} done`, mark);
    await t.idle(700, 5000);
  }
  const cpDir = findDir(join(home, '.qwen'), 'checkpoints');
  const cps = cpDir ? readdirSync(cpDir).filter((f) => f.endsWith('.json')).sort() : [];
  log.checkpoints = cps;
  const target = cps.find((f) => f.includes('c.txt'));
  if (!cpDir || !target) throw new Error('no c.txt checkpoint');
  const cpPath = join(cpDir, target);
  const cp = JSON.parse(readFileSync(cpPath, 'utf8'));
  log.checkpointKeys = Object.keys(cp);
  log.checkpointPromptIds = cp.promptIds ?? null;
  log.checkpointClientHistoryLen = cp.clientHistory?.length ?? null;
  if (LEGACY) {
    delete cp.promptIds;
    writeFileSync(cpPath, JSON.stringify(cp, null, 2));
  }
  // Keep only the target so the /restore completion dropdown has one candidate.
  for (const f of cps) if (f !== target) renameSync(join(cpDir, f), join(runDir, f));
  let mark = t.outputLength;
  await t.type(`/restore ${target.replace(/\.json$/, '')}`);
  await t.idle(600, 3000);
  await t.type('\r');
  await t.idle(800, 3000);
  if (!/Apply this change\?/.test(t.raw.slice(mark))) await t.type('\r');
  await t.waitForSince('Apply this change?', mark, { timeout: 15000 });
  log.filesDuringRestore = listFiles(ws);
  await t.idle(800, 4000);
  await t.capture('00-restore-replay-approval.png');
  const m3 = t.outputLength;
  await t.type('\r');
  await t.idle(2500, 12000);
  log.continuationAfterReplay = /T3 done/.test(t.raw.slice(m3));
  log.filesAfterRestore = listFiles(ws);
  await t.capture('01-after-restore.png');

  // Rewind to T2 (one up from the preselected T3).
  mark = t.outputLength;
  await doubleEsc(t);
  await t.waitForSince('Rewind Conversation', mark, { timeout: 8000 });
  await t.idle(400, 3000);
  await t.type('\x1b[A');
  await t.idle(300, 2000);
  await t.capture('02-selector.png');
  await t.type('\r');
  await t.waitForSince('Restore conversation only', mark, { timeout: 8000 });
  await t.idle(800, 3000);
  await t.capture('03-options.png');
  log.options = (await t.getScreenText()).split('\n').filter((l) => /Restore|Never mind/.test(l)).map((s) => s.replace(/[│›]/g, '').trim());
  await t.type('\r');
  await t.idle(1500, 8000);
  log.rewindLines = (await t.getScreenText()).split('\n').filter((l) => /rewound|Cannot|Restored|restore/i.test(l)).map((s) => s.trim());
  log.filesAfterRewind = listFiles(ws);
  await t.capture('04-after-rewind.png');
  await t.type('\x15');
  await t.idle(300, 2000);
  mark = t.outputLength;
  await send(t, 'T4: CHECK what do you see');
  await t.waitForSince('CONTEXT CHECK', mark, { timeout: 30000 });
  await t.idle(800, 5000);
  await t.capture('05-context-check.png');
  log.screenTail = (await t.getScreenText()).split('\n').slice(-30).join('\n');
} catch (e) {
  log.error = String(e);
  await t.capture('99-error.png').catch(() => {});
  log.errorScreen = await t.getScreenText().catch(() => '');
} finally {
  const main = fake.requests.filter(isMain);
  const t4 = main.find((r) => /\bT4:/.test(msgText(r.body.messages.at(-1))));
  log.t4Markers = t4 ? userMarkers(t4) : null;
  writeFileSync(join(runDir, 'result.json'), JSON.stringify(log, null, 2));
  console.log(JSON.stringify({ ...log, screenTail: undefined, errorScreen: undefined }, null, 2));
  await t.close();
  await fake.close();
}
