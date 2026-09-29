// S5: /compress between turns; rewind above the boundary (must be refused as
// compressed), rewind below it (must keep the exact post-compression prefix),
// then quit, resume and rewind inside the resumed post-compression range.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ARM, setupRun, cliEnv, boot, send, doubleEsc, listFiles, userMarkers,
  isMain, TerminalCapture, startFake, msgText, type Req, type Reply,
} from './common.mjs';

const { runDir, ws, home, shots } = await setupRun('s5');
function lastUserMarker(req: Req): string | undefined {
  for (let i = req.body.messages.length - 1; i >= 0; i--) {
    const m = req.body.messages[i]!;
    if (m.role !== 'user') continue;
    const mm = /\bT(\d+):/.exec(msgText(m));
    if (mm) return `T${mm[1]}`;
  }
  return undefined;
}
let compressions = 0;
const fake = await startFake((req): Reply => {
  const all = req.body.messages.map(msgText).join('\n');
  const last = req.body.messages.at(-1)!;
  if (all.includes('<state_snapshot>') && !/\bT\d+:/.test(msgText(last)) && last.role !== 'tool') {
    compressions++;
    return { text: '<analysis>ok</analysis>\n<state_snapshot>\nSUMMARY-OF-EARLIER-WORK: two files were written.\n</state_snapshot>' };
  }
  if (!isMain(req)) return { text: 'ok' };
  const text = msgText(last);
  if (last.role === 'tool') return { text: `${lastUserMarker(req)} done.` };
  const m = /\bT(\d+):/.exec(text);
  if (!m) return { text: 'ok' };
  const k = `T${m[1]}`;
  const files: Record<string, string> = { T1: 'a.txt', T2: 'b.txt', T3: 'c.txt', T4: 'd.txt' };
  if (files[k]) return { toolCalls: [{ name: 'write_file', args: { file_path: join(ws, files[k]!), content: `${k}\n` } }] };
  const seen = userMarkers(req).filter((x) => x !== k);
  const summary = req.body.messages.some((mm) => msgText(mm).includes('SUMMARY-OF-EARLIER-WORK'));
  return { text: `CONTEXT CHECK ${k} -> user prompts I still see: [${seen.join(', ')}], summary: ${summary ? 'yes' : 'no'}` };
});

const mk = () => TerminalCapture.create({ cols: 110, rows: 46, cwd: ws, env: cliEnv(home), theme: 'github-dark' as any, chrome: false, outputDir: shots });
const log: Record<string, unknown> = { arm: ARM };
let t = await mk();

async function rewind(upPresses: number, label: string, pick: 'first' | 'conversation') {
  const mark = t.outputLength;
  await doubleEsc(t);
  await t.waitForSince('Rewind Conversation', mark, { timeout: 8000 });
  await t.idle(400, 3000);
  for (let i = 0; i < upPresses; i++) { await t.type('\x1b[A'); await t.idle(250, 2000); }
  await t.capture(`${label}-selector.png`);
  await t.type('\r');
  await t.waitForSince('Restore conversation only', mark, { timeout: 8000 });
  await t.idle(700, 3000);
  const opts = (await t.getScreenText()).split('\n').filter((l) => /Restore|Never mind/.test(l)).map((s) => s.replace(/[│›]/g, '').trim());
  if (pick === 'conversation' && opts[0]?.startsWith('Restore code and conversation')) { await t.type('\x1b[B'); await t.idle(250, 2000); }
  const m2 = t.outputLength;
  await t.type('\r');
  await t.idle(1500, 8000);
  await t.capture(`${label}-result.png`);
  const { default: strip } = await import('strip-ansi');
  const lines = strip(t.raw.slice(m2)).split(/\r?\n/).filter((l: string) => /rewound|Cannot rewind|Restored \d|compressed/i.test(l)).map((s: string) => s.trim());
  return { options: opts, lines: [...new Set(lines)] };
}

try {
  await boot(t, fake.baseUrl, ['--approval-mode', 'yolo']);
  let mark = t.outputLength;
  for (const k of ['T1', 'T2']) {
    mark = t.outputLength;
    await send(t, `${k}: write file. ` + 'padding '.repeat(900));
    await t.waitForSince(`${k} done`, mark, { timeout: 30000 });
    await t.idle(600, 4000);
  }
  mark = t.outputLength;
  await t.type('/compress');
  await t.idle(500, 3000);
  await t.type('\r');
  await t.idle(1200, 5000);
  if (compressions === 0 && !/compress/i.test(t.raw.slice(mark).replace('/compress', ''))) await t.type('\r');
  await t.idle(2500, 15000);
  log.compressions = compressions;
  await t.capture('01-after-compress.png');
  for (const k of ['T3', 'T4']) {
    mark = t.outputLength;
    await send(t, `${k}: write file`);
    await t.waitForSince(`${k} done`, mark, { timeout: 30000 });
    await t.idle(600, 4000);
  }
  log.filesBefore = listFiles(ws);
  // Rewind #1: T1 sits above the compression boundary (up 3 from T4).
  log.rewindT1 = await rewind(3, '02-rewind-t1', 'conversation');
  await new Promise((r) => setTimeout(r, 1200));
  // Rewind #2: T4 (preselected) — keep summary + T3.
  log.rewindT4 = await rewind(0, '03-rewind-t4', 'first');
  log.filesAfterRewindT4 = listFiles(ws);
  await t.type('\x15'); await t.idle(300, 2000);
  mark = t.outputLength;
  await send(t, 'T5: CHECK');
  await t.waitForSince('CONTEXT CHECK T5', mark, { timeout: 30000 });
  await t.idle(800, 5000);
  await t.capture('04-check-t5.png');
  await send(t, '/quit');
  await t.idle(1500, 8000);
  await t.close();

  t = await mk();
  await boot(t, fake.baseUrl, ['--approval-mode', 'yolo', '--continue']);
  await t.idle(1000, 5000);
  await t.capture('05-resumed.png');
  mark = t.outputLength;
  await send(t, 'T6: CHECK');
  await t.waitForSince('CONTEXT CHECK T6', mark, { timeout: 30000 });
  await t.idle(800, 5000);
  // Rewind #3 (resumed): T6 is preselected; go up 1 to T5.
  log.rewindT5Resumed = await rewind(1, '06-rewind-t5-resumed', 'conversation');
  await t.type('\x15'); await t.idle(300, 2000);
  mark = t.outputLength;
  await send(t, 'T7: CHECK');
  await t.waitForSince('CONTEXT CHECK T7', mark, { timeout: 30000 });
  await t.idle(800, 5000);
  await t.capture('07-check-t7.png');
  log.screenTail = (await t.getScreenText()).split('\n').slice(-26).join('\n');
} catch (e) {
  log.error = String(e);
  await t.capture('99-error.png').catch(() => {});
  log.errorScreen = await t.getScreenText().catch(() => '');
} finally {
  const main = fake.requests.filter(isMain);
  for (const k of ['T5', 'T6', 'T7']) {
    const r = main.find((x) => new RegExp(`\\b${k}:`).test(msgText(x.body.messages.at(-1))));
    log[`${k}markers`] = r ? userMarkers(r) : null;
    log[`${k}summary`] = r ? r.body.messages.some((mm) => msgText(mm).includes('SUMMARY-OF-EARLIER-WORK')) : null;
  }
  writeFileSync(join(runDir, 'result.json'), JSON.stringify(log, null, 2));
  console.log(JSON.stringify({ ...log, screenTail: undefined }, null, 2));
  await t.close();
  await fake.close();
}
