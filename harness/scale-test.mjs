// Times the PR's real compiled cleanupOldDebugLogs against a corpus sized like
// a real long-lived ~/.qwen/debug (10.7k entries measured on this machine).
import { mkdirSync, writeFileSync, utimesSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = process.argv[2];
const stale = Number(process.argv[3] ?? 6600);
const fresh = Number(process.argv[4] ?? 4100);
const debugDir = join(root, 'debug');
rmSync(root, { recursive: true, force: true });
mkdirSync(debugDir, { recursive: true });
const D = 24 * 3600 * 1000;
const mk = (days) => {
  const p = join(debugDir, `${randomUUID()}.txt`);
  writeFileSync(p, 'x'.repeat(120));
  const t = new Date(Date.now() - days * D);
  utimesSync(p, t, t);
};
for (let i = 0; i < stale; i++) mk(60);
for (let i = 0; i < fresh; i++) mk(2);
mkdirSync(join(debugDir, 'daemon'));
symlinkSync(readdirSync(debugDir).find((n) => n.endsWith('.txt')), join(debugDir, 'latest'));
const before = readdirSync(debugDir).length;

process.env['QWEN_RUNTIME_DIR'] = root;
const { cleanupOldDebugLogs } = await import(process.argv[5]);
const { isValidSessionId } = await import(process.argv[6]);

const t0 = process.hrtime.bigint();
const r = await cleanupOldDebugLogs({
  cutoffDate: new Date(Date.now() - 30 * D),
  excludeSessionIds: new Set(),
  isValidSessionId,
});
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
const after = readdirSync(debugDir).length;
console.log(JSON.stringify({ entriesBefore: before, entriesAfter: after, result: r, elapsedMs: Math.round(ms) }, null, 2));
