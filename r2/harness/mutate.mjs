// Single-point mutants for the fix commits pushed after the round-1 head
// (9f8c93e). Each mutant: backup file -> exact-string replace -> run the PR's
// own suites -> restore from backup -> assert tree clean.
import { readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';

const root = '/root/verify/pr12234-r2-merged/packages/web-shell';
const out = '/root/verify/pr12234-r2-harness/mutation';
execSync(`mkdir -p ${out}`);
const store = 'client/daemon/session/turn-navigation-store.ts';
const nav = 'client/hooks/useMessageNavigation.ts';
const ui = 'client/components/ConversationSearch.tsx';

const mutants = [
  {
    id: 'M0-control',
    note: 'no edit (harness control: suites must be green)',
    file: store,
    find: null,
  },
  {
    id: 'M1-R3-1',
    note: 'drop `publish({ selected: undefined })` on cancelled locate (09e0714)',
    file: store,
    find: `      if (
        generation === selectionGeneration &&
        request?.isCurrent() === false
      ) {
        publish({ selected: undefined });
      }`,
    replace: ``,
  },
  {
    id: 'M2-R3-15',
    note: 'window-full fallback live hit returns without publishing (09e0714)',
    file: store,
    find: `        publish({
          selected: {
            ordinal: hit.turnOrdinal,
            turnId: hit.turnId,
            status: 'ready',
            location,
          },
          ...(snapshot.error?.operation === 'locate'
            ? { error: undefined }
            : {}),
        });
        return location;
      }
      const materialized`,
    replace: `        return location;
      }
      const materialized`,
  },
  {
    id: 'M3-R3-6',
    note: 'window-full failure keeps the boundary in error instead of restoring it (09e0714)',
    file: store,
    find: `        pageTable.cancelBoundaryLoad(rangeId, direction, request);
        publish(clearBoundaryError());
        throw error;`,
    replace: `        throw error;`,
  },
  {
    id: 'M4-427bcc6',
    note: 'advance generation BEFORE the rejection guards (reverts 427bcc6)',
    file: nav,
    find: `      const state = history.getSnapshot();
      const viewport = history.getViewportSnapshot();
      if (!state.sessionId) return { status: 'not_ready' };`,
    replace: `      const state = history.getSnapshot();
      const viewport = history.getViewportSnapshot();
      generation.current += 1;
      if (!state.sessionId) return { status: 'not_ready' };`,
  },
  {
    id: 'M5-R1-60',
    note: 'drop the IME keyCode===229 guard (c554b17)',
    file: ui,
    find: `if (event.nativeEvent.isComposing || event.keyCode === 229)`,
    replace: `if (event.nativeEvent.isComposing)`,
  },
  {
    id: 'M6-R1-62',
    note: 'incomplete probe scans overwrite the visibility count (c554b17)',
    file: ui,
    find: `if (current && (result.complete || result.messageCount > limit))`,
    replace: `if (current)`,
  },
  {
    id: 'M6b-R1-62',
    note: 'incomplete SEARCH scans overwrite the visibility count (c554b17)',
    file: ui,
    find: `if (result.complete) setCount(result.messageCount);`,
    replace: `setCount(result.messageCount);`,
  },
  {
    id: 'M7-R1-63',
    note: 'fulfilled-but-incomplete scan no longer offers Retry (d6e494b)',
    file: ui,
    find: `    error ||
    (!loading && navigation.mode === 'ready' && persisted?.complete === false);`,
    replace: `    error;`,
  },
  {
    id: 'M8-R1-64',
    note: 'selection snaps back to the first row whenever results change (d6e494b)',
    file: ui,
    find: `      results.some((result) => result.key === current)
        ? current
        : results[0]?.key,`,
    replace: `      results[0]?.key,`,
  },
  {
    id: 'M9-R2-5',
    note: "cancelled locate reported as a failure (e162f3b): `found !== 'cancelled'` dropped",
    file: ui,
    find: `else if (found !== 'cancelled') setLocateError(true);`,
    replace: `else setLocateError(true);`,
  },
];

const suites = [
  'client/daemon/session/conversation-search.test.ts',
  'client/daemon/session/turn-navigation-store.test.ts',
  'client/daemon/session/transcript-page-table.test.ts',
  'client/components/ConversationSearch.test.tsx',
  'client/components/TranscriptViewport.pending.test.tsx',
  'client/components/TranscriptViewport.test.tsx',
  'client/hooks/useMessageNavigation.test.tsx',
];

const rows = [];
const only = process.env.ONLY?.split(',');
for (const m of mutants) {
  if (only && !only.includes(m.id)) continue;
  const path = `${root}/${m.file}`;
  const backup = `${out}/${m.id}.orig`;
  copyFileSync(path, backup);
  try {
    if (m.find !== null) {
      const src = readFileSync(path, 'utf8');
      const count = src.split(m.find).length - 1;
      if (count !== 1) throw new Error(`${m.id}: anchor matched ${count} times`);
      writeFileSync(path, src.replace(m.find, m.replace));
    }
    const json = `${out}/${m.id}.json`;
    const run = spawnSync(
      'npx',
      ['vitest', 'run', ...suites, '--reporter=json', `--outputFile=${json}`],
      { cwd: root, encoding: 'utf8', env: { ...process.env, CI: 'true' } },
    );
    writeFileSync(`${out}/${m.id}.log`, (run.stdout ?? '') + (run.stderr ?? ''));
    const report = JSON.parse(readFileSync(json, 'utf8'));
    const failed = [];
    for (const f of report.testResults)
      for (const t of f.assertionResults)
        if (t.status === 'failed') failed.push(`${f.name.split('/client/')[1]} › ${t.fullName}`);
    rows.push({
      id: m.id,
      note: m.note,
      total: report.numTotalTests,
      passed: report.numPassedTests,
      failed: report.numFailedTests,
      suitesFailedToLoad: report.testResults.filter((f) => f.status === 'failed' && !f.assertionResults.length).length,
      killers: failed,
    });
    console.error(`${m.id}: total=${report.numTotalTests} failed=${report.numFailedTests}`);
  } finally {
    copyFileSync(backup, path);
    rmSync(backup);
  }
}
writeFileSync(`${out}/matrix${only ? '-' + only.join('_') : ''}.json`, JSON.stringify(rows, null, 2));
const dirty = execSync('git status --porcelain -- packages/web-shell/client', {
  cwd: '/root/verify/pr12234-r2-merged',
  encoding: 'utf8',
});
console.log(JSON.stringify({ treeClean: dirty.trim() === '', dirty }, null, 2));
