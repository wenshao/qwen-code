import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARM, setupRun, cliEnv, boot, send, isMain, TerminalCapture, startFake, msgText, type Reply } from './common.mjs';
const { runDir, ws, home, shots } = await setupRun('s9');
const fake = await startFake((req): Reply => {
  if (!isMain(req)) return { text: 'ok' };
  const m = /\bT(\d+):/.exec(msgText(req.body.messages.at(-1)));
  return { text: m ? `T${m[1]} done.` : 'ok' };
});
const t = await TerminalCapture.create({ cols: 110, rows: 40, cwd: ws, env: cliEnv(home), theme: 'github-dark' as any, chrome: false, outputDir: shots });
const log: Record<string, unknown> = { arm: ARM };
try {
  await boot(t, fake.baseUrl, ['--approval-mode', 'yolo']);
  let mark = t.outputLength;
  await send(t, 'T1: hello');
  await t.waitForSince('T1 done', mark, { timeout: 30000 });
  await t.idle(3000, 8000);
  mark = t.outputLength;
  await t.type('/branch'); await t.idle(500, 3000); await t.type('\r'); await t.idle(1200, 4000);
  if (!/resume the original|Cannot branch/.test(t.raw.slice(mark))) await t.type('\r');
  await t.idle(2000, 6000);
  const { default: strip } = await import('strip-ansi');
  log.lines = [...new Set(strip(t.raw.slice(mark)).split(/\r?\n/).filter((l: string) => /branch|resume the original|Branched/i.test(l)).map((s: string) => s.trim()))];
  await t.capture('01-branch.png');
} catch (e) { log.error = String(e); } finally {
  writeFileSync(join(runDir, 'result.json'), JSON.stringify(log, null, 2));
  console.log(JSON.stringify(log));
  await t.close(); await fake.close();
}
