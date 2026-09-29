// S7: a custom slash command that submits a prompt (submit_prompt path).
// Rewind to the command's turn live, then again after quit + --continue.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ARM, setupRun, cliEnv, boot, send, doubleEsc, userMarkers,
  isMain, TerminalCapture, startFake, msgText, findSessionFiles, readJsonl, type Reply,
} from './common.mjs';

const { runDir, ws, home, shots } = await setupRun('s8');
mkdirSync(join(ws, '.qwen', 'commands'), { recursive: true });


const fake = await startFake((req): Reply => {
  if (!isMain(req)) return { text: 'ok' };
  const text = msgText(req.body.messages.at(-1));
  const m = /\bT(\d+):/.exec(text);
  if (!m) return { text: 'ok' };
  const k = `T${m[1]}`;
  if (text.includes('CHECK')) {
    const seen = userMarkers(req).filter((x) => x !== k);
    return { text: `CONTEXT CHECK ${k} -> user prompts I still see: [${seen.join(', ')}]` };
  }
  return { text: `${k} done.` };
});

const mk = () => TerminalCapture.create({ cols: 110, rows: 46, cwd: ws, env: cliEnv(home), theme: 'github-dark' as any, chrome: false, outputDir: shots });
const log: Record<string, unknown> = { arm: ARM };
let t = await mk();
async function rewindTo(up: number, label: string) {
  const mark = t.outputLength;
  await doubleEsc(t);
  await t.waitForSince('Rewind Conversation', mark, { timeout: 8000 });
  await t.idle(400, 3000);
  for (let i = 0; i < up; i++) { await t.type('\x1b[A'); await t.idle(250, 2000); }
  await t.capture(`${label}-selector.png`);
  await t.type('\r');
  await t.waitForSince('Restore conversation only', mark, { timeout: 8000 });
  await t.idle(600, 3000);
  const m2 = t.outputLength;
  await t.type('\r');
  await t.idle(1500, 8000);
  const { default: strip } = await import('strip-ansi');
  return [...new Set(strip(t.raw.slice(m2)).split(/\r?\n/).filter((l: string) => /rewound|Cannot rewind/i.test(l)).map((s: string) => s.trim()))];
}
try {
  await boot(t, fake.baseUrl, ['--approval-mode', 'yolo']);
  let mark = t.outputLength;
  await send(t, 'T1: hello');
  await t.waitForSince('T1 done', mark, { timeout: 30000 });
  await t.idle(600, 4000);
  mark = t.outputLength;
  await send(t, 'T2: summarize @README.md please');
  await t.waitForSince('T2 done', mark, { timeout: 30000 });
  await t.idle(600, 4000);
  mark = t.outputLength;
  await send(t, 'T3: after the command');
  await t.waitForSince('T3 done', mark, { timeout: 30000 });
  await t.idle(800, 4000);
  await send(t, '/quit');
  await t.idle(1500, 8000);
  await t.close();
  // Resume, then rewind to the /greet turn (up 1 from T3).
  t = await mk();
  await boot(t, fake.baseUrl, ['--approval-mode', 'yolo', '--continue']);
  await t.idle(1000, 5000);
  log.resumedRewind = await rewindTo(1, '01-resumed-rewind-atfile');
  await t.type('\x15'); await t.idle(300, 2000);
  mark = t.outputLength;
  await send(t, 'T4: CHECK');
  await t.waitForSince('CONTEXT CHECK T4', mark, { timeout: 30000 });
  await t.idle(800, 5000);
  await t.capture('02-check.png');
  log.screenTail = (await t.getScreenText()).split('\n').slice(-22).join('\n');
} catch (e) {
  log.error = String(e);
  await t.capture('99-error.png').catch(() => {});
  log.errorScreen = await t.getScreenText().catch(() => '');
} finally {
  const main = fake.requests.filter(isMain);
  const r = main.find((x) => /\bT4:/.test(msgText(x.body.messages.at(-1))));
  log.T4markers = r ? userMarkers(r) : null;
  const s = findSessionFiles(home);
  if (s[0]) log.userRecords = readJsonl(s[0]).filter((x) => x.type === 'user').map((x) => ({ subtype: x.subtype ?? null, promptId: x.promptId ? x.promptId.split('########')[1] : null, display: x.systemPayload?.displayText ?? null, text: JSON.stringify(x.message?.parts ?? '').slice(0, 50) }));
  writeFileSync(join(runDir, 'result.json'), JSON.stringify(log, null, 2));
  console.log(JSON.stringify({ ...log, screenTail: undefined }, null, 2));
  await t.close();
  await fake.close();
}
