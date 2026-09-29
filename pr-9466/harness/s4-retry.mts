// S4: T2 fails once (HTTP 400) and is retried with Ctrl+Y. Rewind to T3 (after
// the retried turn), then rewind to the retried T2 itself.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ARM, setupRun, cliEnv, boot, send, doubleEsc, userMarkers,
  isMain, TerminalCapture, startFake, msgText, type Reply,
} from './common.mjs';

const { runDir, ws, home, shots } = await setupRun('s4');
let t2Attempts = 0;
const fake = await startFake((req): Reply => {
  if (!isMain(req)) return { text: 'ok' };
  const last = req.body.messages[req.body.messages.length - 1]!;
  const text = msgText(last);
  const m = /\bT(\d+):/.exec(text);
  if (!m) return { text: 'ok' };
  const n = Number(m[1]);
  if (n === 2) {
    t2Attempts++;
    if (t2Attempts === 1) return { httpError: 400, message: 'scripted one-off failure for T2' };
  }
  if (text.includes('CHECK')) {
    const seen = userMarkers(req).filter((x) => x !== `T${n}`);
    return { text: `CONTEXT CHECK ${n} -> user prompts I still see: [${seen.join(', ')}]` };
  }
  return { text: `T${n} done.` };
});

const t = await TerminalCapture.create({ cols: 110, rows: 46, cwd: ws, env: cliEnv(home), theme: 'github-dark' as any, chrome: false, outputDir: shots });
const log: Record<string, unknown> = { arm: ARM };

async function rewindTo(upPresses: number, label: string) {
  const mark = t.outputLength;
  await doubleEsc(t);
  await t.waitForSince('Rewind Conversation', mark, { timeout: 8000 });
  await t.idle(400, 3000);
  for (let i = 0; i < upPresses; i++) {
    await t.type('\x1b[A');
    await t.idle(250, 2000);
  }
  await t.capture(`${label}-selector.png`);
  await t.type('\r');
  await t.waitForSince('Restore conversation only', mark, { timeout: 8000 });
  await t.idle(600, 3000);
  const m2 = t.outputLength;
  await t.type('\r');
  await t.idle(1500, 8000);
  const out = (await t.getScreenText()).split('\n').filter((l) => /rewound|Cannot rewind|compressed|model history/i.test(l)).map((s) => s.trim());
  await t.capture(`${label}-result.png`);
  return { newText: t.raw.slice(m2).length > 0, lines: out };
}

try {
  await boot(t, fake.baseUrl, ['--approval-mode', 'yolo']);
  let mark = t.outputLength;
  await send(t, 'T1: hello');
  await t.waitForSince('T1 done', mark, { timeout: 30000 });
  await t.idle(600, 4000);
  mark = t.outputLength;
  await send(t, 'T2: this one fails once');
  await t.waitForSince('scripted one-off failure', mark, { timeout: 30000 });
  await t.idle(800, 5000);
  await t.capture('01-t2-failed.png');
  mark = t.outputLength;
  await t.type('\x19'); // Ctrl+Y: retry the last failed request
  await t.waitForSince('T2 done', mark, { timeout: 30000 });
  await t.idle(800, 5000);
  mark = t.outputLength;
  await send(t, 'T3: after the retry');
  await t.waitForSince('T3 done', mark, { timeout: 30000 });
  await t.idle(800, 5000);
  await t.capture('02-before-rewind.png');

  // Rewind #1: target T3 (identified, not retried) — preselected last turn.
  log.rewindT3 = await rewindTo(0, '03-rewind-t3');
  await t.type('\x15');
  await t.idle(300, 2000);
  mark = t.outputLength;
  await send(t, 'T4: CHECK what do you see');
  await t.waitForSince('CONTEXT CHECK 4', mark, { timeout: 30000 });
  await t.idle(800, 5000);

  // Rewind #2: target the retried T2 (one up from T4).
  log.rewindT2 = await rewindTo(1, '04-rewind-t2');
  await t.type('\x15');
  await t.idle(300, 2000);
  mark = t.outputLength;
  await send(t, 'T5: CHECK what do you see');
  await t.waitForSince('CONTEXT CHECK 5', mark, { timeout: 30000 });
  await t.idle(800, 5000);
  await t.capture('05-final.png');
  log.screenTail = (await t.getScreenText()).split('\n').slice(-40).join('\n');
} catch (e) {
  log.error = String(e);
  await t.capture('99-error.png').catch(() => {});
  log.errorScreen = await t.getScreenText().catch(() => '');
} finally {
  const main = fake.requests.filter(isMain);
  log.main = main.map((r) => ({ i: r.index, last: msgText(r.body.messages.at(-1)).slice(0, 40), markers: userMarkers(r) }));
  writeFileSync(join(runDir, 'result.json'), JSON.stringify(log, null, 2));
  console.log(JSON.stringify(log, null, 2));
  await t.close();
  await fake.close();
}
