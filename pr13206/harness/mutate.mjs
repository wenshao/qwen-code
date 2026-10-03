// VERIFICATION RIG ONLY (PR #13206): mutants of the shipped behaviors observed on the real stack,
// each run against the PR's managed suite in a separate worktree (wt-mut).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const W = '/Users/wenshao/pr13206-rig/wt-mut';
const D = `${W}/packages/web-shell/client/components/managed`;
const C = `${D}/java-managed-agent-client.ts`;
const H = `${D}/use-managed-session.ts`;
const OUT = '/Users/wenshao/pr13206-rig/out/mutation';
fs.mkdirSync(OUT, { recursive: true });

const MUTANTS = [
  ['M1', 'S2', C, "  'item.reasoning.delta',\n", "  'item.reasoning.delta',\n  'turn.completed',\n", 'a corrupt turn terminal is skipped instead of resyncing'],
  ['M2', 'S3', C, 'consecutiveCorrupt > MAX_CONSECUTIVE_CORRUPT_FRAMES ||', 'false ||', 'no consecutive-corrupt budget'],
  ['M3', 'S3', C, 'const MAX_CONSECUTIVE_CORRUPT_FRAMES = 3;', 'const MAX_CONSECUTIVE_CORRUPT_FRAMES = 4;', 'budget off by one'],
  ['M4', 'S3', C, '      if (event) {\n        consecutiveCorrupt = 0;\n', '      if (event) {\n', 'a decoded event does not reset the budget'],
  ['M5', 'S1', C, "!SKIP_ON_CORRUPT.has(name ?? '')", 'false', 'fail open: every corrupt name is skipped'],
  ['M6', 'S2c', C, "failure ??= new Error('frame has no data payload');", 'return undefined;', 'a mid-stream frame without data is dropped like a heartbeat'],
  ['M7', 'S4', H, 'if (gapStalls >= 3)', 'if (gapStalls >= 4)', 'stall error one stall late'],
  ['M7b', 'S4', H, 'if (gapStalls >= 3)', 'if (gapStalls >= 2)', 'stall error one stall early'],
  ['M7c', 'S4', H, 'if (gapStalls >= 3)', 'if (gapStalls >= 7)', 'stall error four stalls late'],
  ['M7d', 'S4', H, 'if (gapStalls >= 3)', 'if (gapStalls >= 5)', 'stall error two stalls late'],
  ['M8', 'S4', H, "              retryDelayMs = 3000;\n              if (gapStalls", "              retryDelayMs = 0;\n              if (gapStalls", 'stalled resyncs spin with zero delay'],
  ['M9', 'S8', H, '        if (cursorRef.current !== cursor) {\n          const moved = cursorRef.current;\n          if (moved !== undefined && allowRetry) return fetchPage(moved, false);\n          return;\n        }\n        cursorRef.current = page.olderCursor;', '        cursorRef.current = page.olderCursor;', 'a page fetched on a stale cursor is merged'],
  ['M10', 'S6', H, '          if (moved !== undefined && allowRetry) return fetchPage(moved, false);\n          return;\n        }\n        cursorRef.current = page.olderCursor;', '          return;\n        }\n        cursorRef.current = page.olderCursor;', 'a moved cursor discards the page instead of retrying once'],
  ['M11', 'S6', H, 'pagedHeadRef.current >= firstId - 1;', 'true;', 'paged pages kept across a hole'],
  ['M12', 'S5', H, '                if (event.id >= firstId) return false;\n', '', 'live events inside the reloaded window survive the merge'],
  ['M13', 'S8', H, '          nextCursor = undefined;\n', '          nextCursor = cursorRef.current;\n', 'a full-history reload keeps the stale paging cursor'],
  ['M14', 'S5', H, 'const head = await snapshot(true);', 'const head = await snapshot(false);', 'gap reload replaces the transcript wholesale (base behavior)'],
  ['M15', 'S1', C, 'if (!yieldedAny && skippedTotal > 0) {', 'if (false) {', 'a connection of only skips ends without a resync'],
  ['M16', 'S1', C, '      if (trailing) {\n', '      if (false) {\n', 'a mid-frame disconnect is charged as a corrupt frame'],
];

const only = process.argv.slice(2);
const rows = [];
for (const [id, scenario, file, find, replace, what] of MUTANTS) {
  if (only.length && !only.includes(id)) continue;
  const orig = fs.readFileSync(file, 'utf8');
  const n = orig.split(find).length - 1;
  if (n !== 1) {
    rows.push({ id, scenario, what, result: `ANCHOR x${n}` });
    console.log(`${id} ANCHOR x${n}`);
    continue;
  }
  fs.writeFileSync(file, orig.split(find).join(replace));
  const t = Date.now();
  const r = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.config.ts', 'client/components/managed'], { cwd: `${W}/packages/web-shell`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  fs.writeFileSync(file, orig);
  const log = (r.stdout ?? '') + (r.stderr ?? '');
  fs.writeFileSync(`${OUT}/${id}.log`, log);
  const failed = [...log.matchAll(/(?:FAIL|×)\s+([^\n]+)/g)].map((m) => m[1].trim()).slice(0, 4);
  const summary = (log.match(/Tests\s+[^\n]+/) ?? [''])[0].trim();
  const result = r.status === 0 ? 'SURVIVED' : 'KILLED';
  rows.push({ id, scenario, what, result, summary, failed, ms: Date.now() - t });
  console.log(`${id} ${scenario} ${result}  ${summary}  ${what}`);
}
const clean = spawnSync('git', ['-C', W, 'status', '--short'], { encoding: 'utf8' }).stdout.trim();
console.log(`worktree clean after run: ${clean === '' ? 'yes' : clean}`);
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(rows, null, 2));
