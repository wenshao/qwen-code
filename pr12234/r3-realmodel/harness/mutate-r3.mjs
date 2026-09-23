// Round 3: single-point mutants for the fix commits pushed after round 2
// (6fd5e61, 9826676, 0c73062). backup -> replace nth occurrence -> assert the
// file actually changed -> run the PR's own suites -> restore -> tree clean.
import { readFileSync, writeFileSync, copyFileSync, rmSync, mkdirSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const repo = '/private/var/tmp/pr12234-r3/merged';
const root = `${repo}/packages/web-shell`;
const out = `${repo}/r3rig/mutation`;
mkdirSync(out, { recursive: true });
const store = 'client/daemon/session/turn-navigation-store.ts';
const ui = 'client/components/ConversationSearch.tsx';
const guard6 = `      capturedSession === sessionEpoch &&\n      activeClient !== undefined &&\n      isCurrentClient(activeClient);`;

const mutants = [
  { id: 'N0-control', note: 'no edit', file: store, find: null },
  { id: 'N1', commit: '6fd5e61', note: 'UI: drop the liveBlockId filter on persisted hits', file: ui,
    find: `          !liveRecords.has(hit.recordId) &&\n          !(hit.liveBlockId && liveBlocks.has(hit.liveBlockId)),`,
    replace: `          !liveRecords.has(hit.recordId),` },
  { id: 'N2', commit: '6fd5e61', note: 'store: never pair a persisted user record with its live echo via the prompt alias', file: store,
    find: `          if (candidate?.kind === 'user' && remainingLive.has(candidate))\n            echo = candidate;`,
    replace: `          void candidate;` },
  { id: 'N3', commit: '6fd5e61', note: 'store: drop the containing-turn promptId fallback (pre-tool assistant)', file: store,
    find: `block.meta?.['promptId'] ?? promptId;`, replace: `block.meta?.['promptId'];` },
  { id: 'N4', commit: '6fd5e61', note: 'store: accept any same-prompt live block regardless of text', file: store,
    find: `              candidate.text.length === messageTextLength &&\n              candidate.text === text,`, replace: `              true,` },
  { id: 'N5', commit: '6fd5e61', note: 'UI: threshold probe no longer reruns on live identity changes', file: ui,
    find: `    liveIdentity,\n    limit,`, replace: `    limit,` },
  { id: 'N6', commit: '6fd5e61', note: 'UI: threshold probe no longer reruns on totalTurns', file: ui,
    find: `    navigation.mode,\n    navigation.totalTurns,`, replace: `    navigation.mode,` },
  { id: 'N7', commit: '9826676', note: 'store: live alias location returned without publishing the selection', file: store,
    find: `          return finishLiveLocation(alias);`, replace: `          return alias;` },
  { id: 'N8', commit: '9826676', note: 'store: live-block location returned without publishing the selection', file: store,
    find: `        return finishLiveLocation({\n          turnId: hit.turnId,\n          blockId: liveBlock.id,\n          view: 'live',\n        });`,
    replace: `        return { turnId: hit.turnId, blockId: liveBlock.id, view: 'live' };` },
  { id: 'N9', commit: '0c73062', note: 'store: window-full fallback ignores session epoch/client change', file: store,
    find: guard6, nth: 0, replace: `      true;` },
  { id: 'N10', commit: '0c73062', note: 'store: viewport walk ignores session epoch/client change', file: store,
    find: guard6, nth: 1, replace: `      true;` },
  { id: 'N11', commit: '0c73062', note: 'store: viewport walk ignores client change only (epoch kept)', file: store,
    find: guard6, nth: 1, replace: `      capturedSession === sessionEpoch;` },
];

const suites = [
  'client/daemon/session/conversation-search.test.ts',
  'client/daemon/session/turn-navigation-store.test.ts',
  'client/daemon/session/transcript-page-table.test.ts',
  'client/components/ConversationSearch.test.tsx',
  'client/components/TranscriptViewport.pending.test.tsx',
  'client/components/TranscriptViewport.test.tsx',
  'client/hooks/useMessageNavigation.test.tsx',
  'client/App.test.tsx',
];
const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);
const rows = [];
const only = process.env.ONLY?.split(',');
for (const m of mutants) {
  if (only && !only.includes(m.id)) continue;
  const path = `${root}/${m.file}`;
  const backup = `${out}/${m.id}.orig`;
  copyFileSync(path, backup);
  let mutatedHash = null;
  try {
    const src = readFileSync(path, 'utf8');
    if (m.find !== null) {
      const parts = src.split(m.find);
      const n = m.nth ?? 0;
      if (m.nth === undefined && parts.length !== 2) throw new Error(`${m.id}: anchor matched ${parts.length - 1} times`);
      if (parts.length - 1 <= n) throw new Error(`${m.id}: nth ${n} missing`);
      const next = parts.slice(0, n + 1).join(m.find) + m.replace + parts.slice(n + 1).join(m.find);
      writeFileSync(path, next);
      if (readFileSync(path, 'utf8') === src) throw new Error(`${m.id}: NOT_APPLIED`);
      mutatedHash = hash(next);
    }
    const json = `${out}/${m.id}.json`;
    const run = spawnSync('npx', ['vitest', 'run', ...suites, '--reporter=json', `--outputFile=${json}`],
      { cwd: root, encoding: 'utf8', env: { ...process.env, CI: 'true' } });
    writeFileSync(`${out}/${m.id}.log`, (run.stdout ?? '') + (run.stderr ?? ''));
    const report = JSON.parse(readFileSync(json, 'utf8'));
    const failed = [];
    for (const f of report.testResults)
      for (const t of f.assertionResults)
        if (t.status === 'failed') failed.push(`${f.name.split('/client/')[1]} › ${t.fullName}`);
    const loadFail = report.testResults.filter((f) => f.status === 'failed' && !f.assertionResults.length).map((f) => f.name);
    rows.push({ id: m.id, commit: m.commit, note: m.note, mutatedHash, total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests, loadFail, killers: failed });
    console.error(`${m.id}: total=${report.numTotalTests} failed=${report.numFailedTests} loadFail=${loadFail.length}`);
  } finally {
    copyFileSync(backup, path);
    rmSync(backup);
  }
  writeFileSync(`${out}/matrix${only ? '-' + only.join('_') : ''}.json`, JSON.stringify(rows, null, 2));
}
const dirty = execSync('git status --porcelain -- packages/web-shell/client', { cwd: repo, encoding: 'utf8' });
console.log(JSON.stringify({ treeClean: dirty.trim() === '', dirty }, null, 2));
