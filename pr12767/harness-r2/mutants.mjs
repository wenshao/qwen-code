// Mutation matrix over the PR's store source. Each mutant must apply exactly
// once; the original bytes are restored after every run and checked at exit.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';

const PKG = process.env.PKG ?? '/Users/wenshao/git/qwen-code-pr12767-h2/packages/core';
const SRC = `${PKG}/src/managed-runtime/local-managed-tool-result-store.ts`;
const TESTS = (process.env.TESTS ?? 'src/managed-runtime/local-managed-tool-result-store.test.ts src/managed-runtime/local-managed-tool-result-store.fault.test.ts').split(' ');
const original = fs.readFileSync(SRC, 'utf8');
const originalHash = createHash('sha256').update(original).digest('hex');

const M = [
  ['M01', 'publish: skip the per-ordinal publication marker', `        await this.publishedMarker(stream, fields.ordinal, receipt);\n        await this.ensureStreamAnchor(fields.captureId, fields.streamId);\n        return ok(receipt);`, `        await this.ensureStreamAnchor(fields.captureId, fields.streamId);\n        return ok(receipt);`],
  ['M02', 'publish: skip the namespace stream anchor for a new segment', `        await this.publishedMarker(stream, fields.ordinal, receipt);\n        await this.ensureStreamAnchor(fields.captureId, fields.streamId);`, `        await this.publishedMarker(stream, fields.ordinal, receipt);`],
  ['M03', 'seal: skip the namespace seal anchor for a new seal', `        await this.ensureSealAnchor(fields.captureId, fields.streamId, receipt);\n        return ok(receipt);`, `        return ok(receipt);`],
  ['M04', 'prefix: no read-only retry after a race', `if (!this.lease && !retried) {`, `if (false) {`],
  ['M05', 'publish retry: skip stream directory sync before re-acknowledging', `          await syncDirectory(stream);\n          await this.ensureStreamAnchor(fields.captureId, fields.streamId);\n          return ok(stored);`, `          await this.ensureStreamAnchor(fields.captureId, fields.streamId);\n          return ok(stored);`],
  ['M06', 'ensureDirectory: skip parent sync when the child exists', `  await assertDirectory(directory);\n  await syncDirectory(parent);\n  return directory;`, `  await assertDirectory(directory);\n  return directory;`],
  ['M07', 'conflict: refuse without quarantining the candidate', `            await this.quarantineCandidate(\n              fields.captureId,\n              fields.streamId,\n              bytes,\n              'identity_conflict',\n            );\n`, ``],
  ['M08', 'markCorrupt: never persist a corruption marker', `    const marker = \`corrupt-\${ordinal.toString().padStart(5, '0')}\`;\n    if (`, `    const marker = \`corrupt-\${ordinal.toString().padStart(5, '0')}\`;\n    return;\n    if (`],
  ['M09', 'hashFile: skip the digest comparison', `      hash.digest('hex') !== digest ||`, `      false ||`],
  ['M10', 'readRange: skip the expected-identity comparison', `        identityKeys.some(\n          (key) => manifest[key] !== request.expectedIdentity?.[key],\n        )`, `        false`],
  ['M11', 'readRange: skip the page-position check', `if (!isToolResultPageAt(manifest, entryIndex, pageIndex, page)) {`, `if (false) {`],
  ['M12', 'readRange: skip receipt-vs-page digest comparison', `                receipt.digest !== segment.digest`, `                false`],
  ['M13', 'publish: retain every published buffer (unbounded memory)', `    const bytes = Uint8Array.from(fields.bytes);\n    const received`, `    const bytes = Uint8Array.from(fields.bytes);\n    ((globalThis as any).__o1bRetained ??= []).push(bytes);\n    const received`],
  ['M14', 'close: do not drain queued work', `    this.closePromise = this.tail.finally(() => {`, `    this.closePromise = Promise.resolve().finally(() => {`],
  ['M15', 'owner: ignore workspaceId', `      recorded.workspaceId !== this.sessionKey.workspaceId ||`, ``],
  ['M16', 'assertDirectory: accept symlinks', `  if (stat.isSymbolicLink() || !stat.isDirectory()) {`, `  if (!stat.isDirectory() && !stat.isSymbolicLink()) {`],
  ['M17', 'existingStream: forget stream anchors when the capture dir is gone', `    const capture = path.join(this.root, \`capture-\${captureId}\`);\n    if (!(await maybeStat(capture))) {\n      if (`, `    const capture = path.join(this.root, \`capture-\${captureId}\`);\n    if (!(await maybeStat(capture))) {\n      if (false && `],
  ['M18', 'readSeal: forget the seal anchor when the seal dir is gone', `      if (anchor)\n        throw new CorruptToolResultError('missing sealed tool-result stream.');`, `      if (false)\n        throw new CorruptToolResultError('missing sealed tool-result stream.');`],
  ['M19', 'publish: queue the caller buffer without copying', `    const bytes = Uint8Array.from(fields.bytes);\n    const received`, `    const bytes = fields.bytes;\n    const received`],
  ['M20', 'enqueue: skip the per-operation lease check', `      if (this.lease) await this.lease.assertOwnedAndUnchanged();`, ``],
  ['M21', 'openWritable: accept a lease of another Session', `    if (options.lease.sessionId !== options.sessionKey.sessionId) {`, `    if (false) {`],
  ['M22', 'openWritable: allow a second writable handle in-process', `    if (writableRoots.has(root)) {`, `    if (false) {`],
  ['M23', 'seal: skip re-verification of an existing seal (trust the stored receipt)', `        if (storedSeal) {\n          if (\n            storedSeal.segmentCount !== fields.segmentCount ||\n            storedSeal.byteLength !== fields.byteLength ||\n            storedSeal.digest !== fields.digest\n          ) {\n            return refused('managed_tool_result_conflict');\n          }\n        }`, `        if (storedSeal) {\n          if (\n            storedSeal.segmentCount !== fields.segmentCount ||\n            storedSeal.byteLength !== fields.byteLength ||\n            storedSeal.digest !== fields.digest\n          ) {\n            return refused('managed_tool_result_conflict');\n          }\n          return ok(storedSeal);\n        }`],
  ['M24', 'writeAndSync: skip the file fsync', `    await handle.writeFile(bytes);\n    await handle.sync();`, `    await handle.writeFile(bytes);`],
  ['M25', 'installDirectory: replace an existing ordinal instead of refusing', `    if (await maybeStat(path.join(parent, name))) {\n      throw new ManagedSessionRecordError(\n        'tool-result identity already exists.',\n      );\n    }\n    await rename`, `    await rm(path.join(parent, name), { recursive: true, force: true });\n    await rename`],
  ['M26', 'readRange: allow reads beyond the revision bounds', `        offset > entry.byteLength ||\n        length > entry.byteLength - offset`, `        offset > entry.byteLength + 1`],
  ['C01', 'candidate: drop the re-stat after the marker', `      if (!(await maybeStat(directory))) {\n        if (mark && this.lease) await this.markCorrupt(stream, ordinal);`, `      if (true) {\n        if (mark && this.lease) await this.markCorrupt(stream, ordinal);`],
  ['C02', 'seal: drop published markers from the past-the-count check', `/^(?:segment|published|corrupt)-([0-9]{5})$/`, `/^(?:segment|corrupt)-([0-9]{5})$/`],
  ['C03', 'seal: drop corrupt markers from the past-the-count check', `/^(?:segment|published|corrupt)-([0-9]{5})$/`, `/^(?:segment|published)-([0-9]{5})$/`],
  ['C04', 'seal: drop the past-the-count check entirely', `            return match && Number(match[1]) >= fields.segmentCount;`, `            return match && false;`],
];

const only = process.env.ONLY?.split(',');
const results = [];
try {
  for (const [id, desc, find, replace] of M) {
    if (only && !only.includes(id)) continue;
    const n = original.split(find).length - 1;
    if (n !== 1) {
      results.push({ id, desc, verdict: `NOT APPLIED (${n} matches)` });
      continue;
    }
    fs.writeFileSync(SRC, original.replace(find, replace));
    const t0 = Date.now();
    const run = spawnSync('npx', ['vitest', 'run', ...TESTS, '--coverage.enabled=false'], { cwd: PKG, encoding: 'utf8', timeout: 600_000 });
    const text = (run.stdout ?? '') + (run.stderr ?? '');
    const m = text.match(/Tests\s+(.*)\n/);
    const failed = [...text.matchAll(/(?:×|FAIL)\s+(.+?)(?:\s+\d+ms)?$/gm)].map((x) => x[1]).filter((s) => !s.includes('.test.ts') || s.includes('>')).slice(0, 4);
    const verdict = run.status === 0 ? 'SURVIVED' : m ? 'KILLED' : 'ERROR';
    results.push({ id, desc, verdict, tests: m?.[1]?.trim(), seconds: Math.round((Date.now() - t0) / 1000), failed });
    console.error(`${id} ${verdict} ${m?.[1]?.trim() ?? ''}`);
    fs.writeFileSync(SRC, original);
  }
} finally {
  fs.writeFileSync(SRC, original);
  const now = createHash('sha256').update(fs.readFileSync(SRC)).digest('hex');
  console.error(`restored: ${now === originalHash}`);
}
console.log(JSON.stringify(results, null, 1));
console.log(`PROBE_JSON ${JSON.stringify({ probe: 'mutants', total: results.length, killed: results.filter((r) => r.verdict === 'KILLED').length, survived: results.filter((r) => r.verdict === 'SURVIVED').map((r) => r.id), other: results.filter((r) => !['KILLED', 'SURVIVED'].includes(r.verdict)).map((r) => `${r.id}:${r.verdict}`) })}`);
