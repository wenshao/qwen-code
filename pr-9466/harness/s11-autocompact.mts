// S11: auto-compaction fires while T3 is being sent (T2's response reports a
// prompt size above the auto threshold). Quit, resume, and ask the model what
// it still sees — is T3's question part of the resumed model history?
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ARM, setupRun, cliEnv, boot, send, userMarkers,
  isMain, TerminalCapture, startFake, msgText, findSessionFiles, readJsonl, type Reply,
} from './common.mjs';

const TIER = process.env.TIER ?? 'soft';
const HIGH = TIER === 'hard' ? '190000' : '170000';
const { runDir, ws, home, shots } = await setupRun(`s11${TIER}`);
let compressions = 0;
const fake = await startFake((req): Reply => {
  const all = req.body.messages.map(msgText).join('\n');
  const last = req.body.messages.at(-1)!;
  if (all.includes('<state_snapshot>') && !/\bT\d+:/.test(msgText(last))) {
    compressions++;
    return { text: '<analysis>ok</analysis>\n<state_snapshot>\nSUMMARY-OF-EARLIER-WORK\n</state_snapshot>' };
  }
  if (!isMain(req)) return { text: 'ok' };
  const text = msgText(last);
  const m = /\bT(\d+):/.exec(text);
  if (!m) return { text: 'ok' };
  const k = `T${m[1]}`;
  if (text.includes('CHECK')) {
    const seen = userMarkers(req).filter((x) => x !== k);
    const summary = req.body.messages.some((mm) => msgText(mm).includes('SUMMARY-OF-EARLIER-WORK'));
    return { text: `CONTEXT CHECK ${k} -> user prompts I still see: [${seen.join(', ')}], summary: ${summary ? 'yes' : 'no'}` };
  }
  return { text: `${k} done.` };
});

const mk = () => TerminalCapture.create({ cols: 110, rows: 46, cwd: ws, env: cliEnv(home), theme: 'github-dark' as any, chrome: false, outputDir: shots });
const log: Record<string, unknown> = { arm: ARM, tier: TIER };
let t = await mk();
try {
  await boot(t, fake.baseUrl, ['--approval-mode', 'yolo']);
  let mark = t.outputLength;
  await send(t, 'T1: hello ' + 'padding '.repeat(400));
  await t.waitForSince('T1 done', mark, { timeout: 30000 });
  await t.idle(600, 4000);
  process.env.FAKE_PROMPT_TOKENS = HIGH; // T2's response reports a near-full window
  mark = t.outputLength;
  await send(t, 'T2: more ' + 'padding '.repeat(400));
  await t.waitForSince('T2 done', mark, { timeout: 30000 });
  await t.idle(800, 4000);
  process.env.FAKE_PROMPT_TOKENS = '100';
  mark = t.outputLength;
  await send(t, 'T3: the question that triggers auto-compaction');
  await t.waitForSince('T3 done', mark, { timeout: 60000 });
  await t.idle(1500, 8000);
  log.compressions = compressions;
  await t.capture('01-after-autocompact.png');
  const { default: strip } = await import('strip-ansi');
  log.compressLines = [...new Set(strip(t.raw.slice(mark)).split(/\r?\n/).filter((l: string) => /compress/i.test(l)).map((s: string) => s.trim()))];
  mark = t.outputLength;
  await send(t, 'T4: CHECK live');
  await t.waitForSince('CONTEXT CHECK T4', mark, { timeout: 30000 });
  await t.idle(800, 4000);
  await send(t, '/quit');
  await t.idle(1500, 8000);
  await t.close();
  t = await mk();
  await boot(t, fake.baseUrl, ['--approval-mode', 'yolo', '--continue']);
  await t.idle(1000, 5000);
  mark = t.outputLength;
  await send(t, 'T5: CHECK resumed');
  await t.waitForSince('CONTEXT CHECK T5', mark, { timeout: 30000 });
  await t.idle(800, 5000);
  await t.capture('02-resumed-check.png');
} catch (e) {
  log.error = String(e);
  await t.capture('99-error.png').catch(() => {});
  log.errorScreen = (await t.getScreenText().catch(() => '')).slice(-1500);
} finally {
  const main = fake.requests.filter(isMain);
  for (const k of ['T4', 'T5']) {
    const r = main.find((x) => new RegExp(`\\b${k}:`).test(msgText(x.body.messages.at(-1))));
    log[`${k}markers`] = r ? userMarkers(r) : null;
    log[`${k}summary`] = r ? r.body.messages.some((mm) => msgText(mm).includes('SUMMARY-OF-EARLIER-WORK')) : null;
  }
  const s = findSessionFiles(home);
  if (s[0]) {
    const comp = readJsonl(s[0]).filter((x) => x.subtype === 'chat_compression');
    log.compressionRecords = comp.map((c) => ({
      entries: (c.systemPayload?.compressedHistory ?? []).map((e: any) => `${e.role}:${JSON.stringify(e.parts ?? '').slice(0, 30)}`),
      promptIds: (c.systemPayload?.promptIds ?? null)?.map((p: any) => (p ? p.split('########')[1] : null)) ?? null,
    }));
  }
  writeFileSync(join(runDir, 'result.json'), JSON.stringify(log, null, 2));
  console.log(JSON.stringify({ ...log }, null, 2));
  await t.close();
  await fake.close();
}
