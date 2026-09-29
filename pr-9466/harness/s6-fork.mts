// S1: a background-shell completion notification enters the model history as a
// `user` entry but renders as a notification, not a user turn. Rewind to T3 and
// ask the model what it still sees.
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ARM, setupRun, cliEnv, boot, send, doubleEsc, listFiles, userMarkers, notificationCount,
  isMain, TerminalCapture, startFake, msgText, findSessionFiles, readJsonl, type Req, type Reply,
} from './common.mjs';

const { runDir, ws, home, shots } = await setupRun('s6');

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
  const last = req.body.messages[req.body.messages.length - 1]!;
  const text = msgText(last);
  if (last.role === 'tool') return { text: `${lastUserMarker(req)} done.` };
  if (text.includes('<task-notification>')) return { text: 'Noted: background job finished.' };
  if (/\bT1:/.test(text)) return { toolCalls: [{ name: 'run_shell_command', args: { command: 'sleep 2; echo BG-DONE', is_background: true, description: 'background job' } }] };
  if (/\bT2:/.test(text)) return { toolCalls: [{ name: 'write_file', args: { file_path: join(ws, 'b.txt'), content: 'B\n' } }] };
  if (/\bT3:/.test(text)) return { toolCalls: [{ name: 'write_file', args: { file_path: join(ws, 'c.txt'), content: 'C\n' } }] };
  if (/\bT4:/.test(text)) return { toolCalls: [{ name: 'write_file', args: { file_path: join(ws, 'd.txt'), content: 'D\n' } }] };
  if (/\bT5:/.test(text)) {
    const seen = userMarkers(req).filter((m) => m !== 'T5');
    return { text: `CONTEXT CHECK -> user prompts I still see: [${seen.join(', ')}], notifications: ${notificationCount(req)}` };
  }
  return { text: 'ok' };
});


const mk = () => TerminalCapture.create({ cols: 110, rows: 46, cwd: ws, env: cliEnv(home), theme: 'github-dark' as any, chrome: false, outputDir: shots });
const log: Record<string, unknown> = { arm: ARM };
let t = await mk();
try {
  await boot(t, fake.baseUrl, ['--approval-mode', 'yolo']);
  let mark = t.outputLength;
  await send(t, 'T1: start the background job');
  await t.waitForSince('T1 done', mark, { timeout: 30000 });
  await t.waitForSince('Noted: background job finished', mark, { timeout: 30000 });
  await t.idle(800, 5000);
  mark = t.outputLength;
  await send(t, 'T2: create b.txt');
  await t.waitForSince('T2 done', mark, { timeout: 30000 });
  await t.idle(600, 5000);
  mark = t.outputLength;
  await send(t, 'T3: create c.txt');
  await t.waitForSince('T3 done', mark, { timeout: 30000 });
  await t.idle(800, 5000);
  await send(t, '/quit');
  await t.idle(1500, 8000);
  await t.close();

  // Phase B: resume the same session in a fresh process.
  t = await mk();
  await boot(t, fake.baseUrl, ['--approval-mode', 'yolo', '--continue', '--fork-session']);
  await t.waitFor('T3 done', { timeout: 20000 });
  await t.idle(800, 5000);
  await t.capture('01-resumed.png');
  mark = t.outputLength;
  await send(t, 'T4: create d.txt');
  await t.waitForSince('T4 done', mark, { timeout: 30000 });
  await t.idle(800, 5000);
  log.filesBeforeRewind = listFiles(ws);
  await doubleEsc(t);
  await t.waitForSince('Rewind Conversation', mark, { timeout: 8000 });
  await t.idle(500, 3000);
  await t.type('\x1b[A'); // from T4 up to T3 (inside the forked range)
  await t.idle(400, 3000);
  await t.capture('02-selector.png');
  mark = t.outputLength;
  await t.type('\r');
  await t.waitForSince('Restore conversation only', mark, { timeout: 8000 });
  await t.idle(800, 3000);
  await t.capture('03-options.png');
  const optionsScreen = await t.getScreenText();
  log.codeRestoreOffered = optionsScreen.includes('Restore code and conversation');
  mark = t.outputLength;
  await t.type('\r'); // first option
  await t.idle(1500, 8000);
  log.filesAfterRewind = listFiles(ws);
  await t.capture('04-after-rewind.png');
  log.afterRewindScreen = (await t.getScreenText()).split('\n').filter((l) => /rewound|Restored|Cannot|Failed|restore/i.test(l));
  await t.type('\x15');
  await t.idle(300, 2000);
  mark = t.outputLength;
  await send(t, 'T5: which of my prompts do you still see?');
  await t.waitForSince('CONTEXT CHECK', mark, { timeout: 30000 });
  await t.idle(800, 5000);
  await t.capture('05-context-check.png');
  log.screenTail = (await t.getScreenText()).split('\n').slice(-34).join('\n');
} catch (e) {
  log.error = String(e);
  await t.capture('99-error.png').catch(() => {});
  log.errorScreen = await t.getScreenText().catch(() => '');
} finally {
  const main = fake.requests.filter(isMain);
  log.mainRequests = main.map((r) => ({ index: r.index, lastRole: r.body.messages.at(-1)?.role, markers: userMarkers(r), notifications: notificationCount(r) }));
  const t5 = main.find((r) => /\bT5:/.test(msgText(r.body.messages.at(-1))));
  log.t5Markers = t5 ? userMarkers(t5) : null;
  log.t5Notifications = t5 ? notificationCount(t5) : null;
  if (t5) writeFileSync(join(runDir, 't5-request.json'), JSON.stringify(t5.body.messages, null, 2));
  const sessions = findSessionFiles(home);
  log.sessionFiles = sessions;
  writeFileSync(join(runDir, 'result.json'), JSON.stringify(log, null, 2));
  console.log(JSON.stringify({ ...log, mainRequests: undefined }, null, 2));
  await t.close();
  await fake.close();
}
