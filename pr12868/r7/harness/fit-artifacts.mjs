// PR #12868 round 7, commit 760174073b: the result fitter and artifacts.
// Artifacts feed a client surface only. The commit drops them, after a
// structured display was stubbed and before hook results are dropped, when
// even fully cut text cannot fit beside them.
// No stack is needed: the function is imported from the arm's dist.
// usage: ARM=<arm> node fit-artifacts.mjs
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ARM, WT, check, openLog, say, summary } from './lib.mjs';

openLog(`fit-artifacts-${ARM}`);
const mod = await import(pathToFileURL(path.join(WT, 'packages/cli/dist/src/serve/managed-runtime-provider-protocol.js')).href);
const fit = mod.fitManagedRuntimeProviderResult;
const STUB = '[Managed Runtime provider omitted this tool result to fit the wire limit.]';
const LIMIT = 1024 * 1024;
const bytes = (v) => Buffer.byteLength(JSON.stringify(v), 'utf8');
const kib = (n) => `${(n / 1024).toFixed(0)} KiB`;
const artifacts = (size) => [{ title: 'report', description: 'd'.repeat(size) }];
const diff = (size) => ({ fileDiff: 'x'.repeat(size), fileName: 'a.txt', originalContent: '', newContent: '' });

const CASES = [
  ['artifacts of 1.5 MiB beside 1,000 characters for the model and a hook result', () => ({ executionStatus: 'success', result: { llmContent: 'l'.repeat(1000), artifacts: artifacts(1536 * 1024) }, postHook: { additionalContext: 'kept' } })],
  ['artifacts of 1.5 MiB beside 300 KiB for the model', () => ({ executionStatus: 'success', result: { llmContent: 'l'.repeat(300 * 1024), artifacts: artifacts(1536 * 1024) } })],
  ['small artifacts beside 2 MiB for the model', () => ({ executionStatus: 'success', result: { llmContent: 'l'.repeat(2 * LIMIT), artifacts: artifacts(200) } })],
  ['artifacts of 600 KiB, a file diff of 600 KiB, and 1,000 characters for the model', () => ({ executionStatus: 'success', result: { llmContent: 'l'.repeat(1000), returnDisplay: diff(600 * 1024), artifacts: artifacts(600 * 1024) }, postHook: { additionalContext: 'kept' } })],
  ['artifacts of 600 KiB beside 200 KiB for the model: the result already fits', () => ({ executionStatus: 'success', result: { llmContent: 'l'.repeat(200 * 1024), artifacts: artifacts(600 * 1024) } })],
];
const rows = [];
for (const [what, make] of CASES) {
  const value = make();
  const before = structuredClone(value);
  let threw;
  try {
    fit({ kind: 'execute' }, value, LIMIT);
  } catch (error) {
    threw = String(error?.message ?? error);
  }
  const r = value.result ?? {};
  const row = {
    what, threw, size: bytes(value), fits: bytes(value) <= LIMIT,
    model: r.llmContent === before.result.llmContent ? 'kept whole' : r.llmContent === STUB ? 'replaced by the stub' : `cut to ${kib(String(r.llmContent).length)}`,
    artifacts: r.artifacts === undefined ? 'dropped' : JSON.stringify(r.artifacts) === JSON.stringify(before.result.artifacts) ? 'kept' : 'changed',
    display: before.result.returnDisplay === undefined ? '-' : r.returnDisplay === STUB ? 'replaced by the stub' : 'kept',
    hook: before.postHook === undefined ? '-' : value.postHook === undefined ? 'dropped' : 'kept',
    unchanged: JSON.stringify(value) === JSON.stringify(before),
  };
  rows.push(row);
  say('A', `${what} | before ${kib(bytes(before))} | after ${threw ? `threw: ${threw.slice(0, 80)}` : `${kib(row.size)}, fits=${row.fits}`} | for the model: ${row.model} | artifacts ${row.artifacts} | display ${row.display} | hook result ${row.hook}`);
}
const [big, bigBoth, small, withDiff, already] = rows;
check('A.1', 'every fitted result fits the limit', rows.every((r) => !r.threw && r.fits), JSON.stringify(rows.map((r) => r.fits)));
check('A.2', 'artifacts that cannot fit are dropped, and what the model gets and the hook result are kept whole', big.artifacts === 'dropped' && big.model === 'kept whole' && big.hook === 'kept', `artifacts ${big.artifacts}, model ${big.model}, hook ${big.hook}`);
check('A.3', 'beside artifacts that cannot fit, the text for the model is not replaced by the stub', bigBoth.artifacts === 'dropped' && bigBoth.model !== 'replaced by the stub', `artifacts ${bigBoth.artifacts}, model ${bigBoth.model}`);
check('A.4', 'artifacts that fit beside the cut text are kept', small.artifacts === 'kept' && small.model.startsWith('cut'), `artifacts ${small.artifacts}, model ${small.model}`);
check('A.5', 'a structured display goes first, artifacts next, and the hook result stays', withDiff.display === 'replaced by the stub' && withDiff.model === 'kept whole' && withDiff.hook === 'kept', `display ${withDiff.display}, artifacts ${withDiff.artifacts}, model ${withDiff.model}, hook ${withDiff.hook}`);
check('A.6', 'a result that already fits is returned unchanged', already.unchanged, `artifacts ${already.artifacts}, model ${already.model}`);
process.exit(summary() ? 0 : 1);
