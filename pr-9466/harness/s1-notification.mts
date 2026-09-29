// S1: a background-shell completion notification enters the model history as a
// `user` entry but renders as a notification, not a user turn. Rewind to T3 and
// ask the model what it still sees.
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ARM, setupRun, cliEnv, boot, send, doubleEsc, listFiles, userMarkers, notificationCount,
  isMain, TerminalCapture, startFake, msgText, findSessionFiles, readJsonl, type Req, type Reply,
} from './common.mjs';

const { runDir, ws, home, shots } = await setupRun('s1');

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
  if (/\bT4:/.test(text)) {
    const seen = userMarkers(req).filter((m) => m !== 'T4');
    return { text: `CONTEXT CHECK -> user prompts I still see: [${seen.join(', ')}], notifications: ${notificationCount(req)}` };
  }
  return { text: 'ok' };
});

const t = await TerminalCapture.create({ cols: 110, rows: 42, cwd: ws, env: cliEnv(home), theme: 'github-dark' as any, chrome: false, outputDir: shots });
const log: Record<string, unknown> = { arm: ARM };
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
  log.filesBeforeRewind = listFiles(ws);
  await t.capture('01-before-rewind.png');

  await doubleEsc(t);
  await t.waitFor('Rewind Conversation', { timeout: 8000 });
  await t.idle(500, 3000);
  await t.capture('02-selector.png');
  await t.type('\r'); // last turn (T3) is preselected
  await t.waitFor('Restore code and conversation', { timeout: 8000 });
  await t.idle(500, 3000);
  await t.capture('03-options.png');
  mark = t.outputLength;
  await t.type('\r'); // Restore code and conversation
  await t.waitForSince('Conversation rewound', mark, { timeout: 15000 });
  await t.idle(800, 5000);
  log.filesAfterRewind = listFiles(ws);
  await t.capture('04-after-rewind.png');

  await t.type('\x15'); // Ctrl+U clears the refilled prompt
  await t.idle(300, 2000);
  mark = t.outputLength;
  await send(t, 'T4: which of my prompts do you still see?');
  await t.waitForSince('CONTEXT CHECK', mark, { timeout: 30000 });
  await t.idle(800, 5000);
  await t.capture('05-context-check.png');
  log.screenTail = (await t.getScreenText()).split('\n').slice(-30).join('\n');
} catch (e) {
  log.error = String(e);
  await t.capture('99-error.png').catch(() => {});
} finally {
  const main = fake.requests.filter(isMain);
  log.mainRequests = main.map((r) => ({ index: r.index, lastRole: r.body.messages.at(-1)?.role, markers: userMarkers(r), notifications: notificationCount(r) }));
  const t4 = main.find((r) => /\bT4:/.test(msgText(r.body.messages.at(-1))));
  log.t4Markers = t4 ? userMarkers(t4) : null;
  log.t4Notifications = t4 ? notificationCount(t4) : null;
  if (t4) writeFileSync(join(runDir, 't4-request.json'), JSON.stringify(t4.body.messages, null, 2));
  log.totalRequests = fake.requests.length;
  const sessions = findSessionFiles(home);
  log.sessionFiles = sessions;
  if (sessions[0]) {
    log.userRecords = readJsonl(sessions[0])
      .filter((r) => r.type === 'user')
      .map((r) => ({ subtype: r.subtype ?? null, promptId: r.promptId ?? null, text: JSON.stringify(r.message?.parts ?? '').slice(0, 60) }));
  }
  writeFileSync(join(runDir, 'result.json'), JSON.stringify(log, null, 2));
  console.log(JSON.stringify(log, null, 2));
  await t.close();
  await fake.close();
}
