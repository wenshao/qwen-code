// TypeScript mutants for PR #13088 (exact-string, one hit each). Run: node ts-mutants.mjs [ids...]
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const W = '/rig/wt-mut';
const H = 'packages/cli/src/serve/hosted-harness-session.ts';
const P = 'packages/core/src/managed-runtime/managed-session-message-projection.ts';
const K = 'packages/core/src/managed-runtime/managed-session-record-sink.ts';
const CLI = { dir: 'packages/cli', files: ['src/serve/hosted-harness-session.test.ts'] };
const CORE = { dir: 'packages/core', files: ['src/managed-runtime/managed-session-message-projection.test.ts', 'src/managed-runtime/managed-session-record-sink.test.ts'] };
const M = [
  { id: 'T01', what: 'load: skip the whole restore verification', file: H, find: 'if (!create && toolProfile) {\n        try {\n          await verifyWorkspaceRestore(', to: 'if (false) {\n        try {\n          await verifyWorkspaceRestore(', tests: [CLI] },
  { id: 'T02', what: 'load: drop the writer-ownership recheck (assertWritable) before publishing', file: H, find: '          await stores.assertWritable();\n        } catch {', to: '        } catch {', tests: [CLI] },
  { id: 'T03', what: 'load: do not read the saved tool profile when Java omits it', file: H, find: "      if (!create && toolProfile === undefined)\n        toolProfile = definition?.['toolProfile'];\n", to: '', tests: [CLI] },
  { id: 'T04', what: 'unsettled-input check reads to the live head, not the restore cut', file: H, find: 'for (const event of authority.eventsInSequenceRange(1, throughSequence)) {\n    if (event.kind === \'input.accepted\')', to: 'for (const event of authority.eventsInSequenceRange(1, authority.committedSequence)) {\n    if (event.kind === \'input.accepted\')', tests: [CLI] },
  { id: 'T05', what: 'event walk reads to the live head, not the restore cut', file: H, find: 'for (const event of authority.eventsInSequenceRange(1, throughSequence)) {\n    if (\n      event.kind === \'domain.committed\'', to: 'for (const event of authority.eventsInSequenceRange(1, authority.committedSequence)) {\n    if (\n      event.kind === \'domain.committed\'', tests: [CLI] },
  { id: 'T06', what: 'unsupported domain no longer refused', file: H, find: "      throw new Error('Hosted recovery domain is unsupported.');", to: '      continue;', tests: [CLI] },
  { id: 'T07', what: 'file-history / media checkpoint layout no longer refused', file: H, find: "      if (\n        checkpoint.resume.fileHistoryRef ||\n        checkpoint.output.mediaRefs.length\n      )\n        throw new Error('Hosted recovery layout is unsupported.');", to: '', tests: [CLI] },
  { id: 'T08', what: 'conflicting reference metadata no longer refused', file: H, find: "        throw new Error('Hosted resource references conflict.');\n      return;", to: '      return;', tests: [CLI] },
  { id: 'T09', what: 'checkpoint nested references not read', file: H, find: '      for (const nested of refs) {\n        if (nested) await readRef(nested);\n      }', to: '', tests: [CLI] },
  { id: 'T10', what: 'title record: previous-record reference not followed', file: H, find: "      if (metadata['previousRecordRef'])\n        await readRef(\n          metadata['previousRecordRef'] as unknown as ManagedSessionDurableRef,\n        );", to: '', tests: [CLI] },
  { id: 'T11', what: 'title record: title type not checked', file: H, find: "      if (!metadata || typeof metadata['title'] !== 'string')\n        throw new Error('Hosted recovery layout is unsupported.');", to: '', tests: [CLI] },
  { id: 'T12', what: 'event `resources` arrays not read', file: H, find: "      } else if (field === 'resources' && Array.isArray(value)) {", to: "      } else if (false && field === 'resources' && Array.isArray(value)) {", tests: [CLI] },
  { id: 'T13', what: 'event `*Ref` fields not read', file: H, find: "      if (field.endsWith('Ref') && value !== null && value !== undefined) {", to: "      if (false && field.endsWith('Ref') && value !== null && value !== undefined) {", tests: [CLI] },
  { id: 'T14', what: 'Shell manifests not verified at all', file: H, find: '  for (const ref of manifests.values()) {', to: '  for (const ref of [] as ManagedSessionDurableRef[]) {', tests: [CLI] },
  { id: 'T15', what: 'incomplete capture accepted', file: H, find: "    if (manifest.captureStatus !== 'complete')\n      throw new Error('Hosted tool result capture is incomplete.');", to: '', tests: [CLI] },
  { id: 'T16', what: 'empty stream: seal not required', file: H, find: '          offset < content.byteLength ||\n          (content.byteLength === 0 && offset === 0);', to: '          offset < content.byteLength;', tests: [CLI] },
  { id: 'T17', what: 'segmented stream: full-stream digest not compared', file: H, find: "        if (hash.digest('hex') !== content.digest)\n          throw new Error('Hosted tool result content is incomplete.');", to: '', tests: [CLI] },
  { id: 'T18', what: 'segmented stream: a failed range read is accepted', file: H, find: "          if (read.status !== 'ok')\n            throw new Error('Hosted tool result content is incomplete.');", to: "          if (read.status !== 'ok') break;", tests: [CLI] },
  { id: 'T19', what: 'inline content: digest not compared', file: H, find: "        if (createHash('sha256').update(bytes).digest('hex') !== content.digest)\n          throw new Error('Hosted tool result content is incomplete.');", to: '', tests: [CLI] },
  { id: 'T20', what: 'message projection not run at load', file: H, find: '  await sink.project(throughSequence);\n}', to: '}', tests: [CLI] },
  { id: 'T21', what: 'header root snapshot / transcript proof not read', file: H, find: '  await readRef(header.rootSnapshotRef);\n  if (header.baseTranscriptProof) await readRef(header.baseTranscriptProof);', to: '', tests: [CLI] },
  { id: 'T22', what: 'a wrong supplied profile is accepted on load', file: H, find: "      if (definition?.['toolProfile'] !== toolProfile) {", to: "      if (create && definition?.['toolProfile'] !== toolProfile) {", tests: [CLI] },
  { id: 'T23', what: 'projection: ignores the cut (returns records past throughSequence)', file: P, find: '        if (throughSequence !== undefined && event.sequence > throughSequence)\n          return records;\n', to: '', tests: [CORE] },
  { id: 'T24', what: 'projection: branch checkpoints resolved at the live head, not the cut', file: P, find: '          throughSequence ?? this.authority.committedSequence,', to: '          this.authority.committedSequence,', tests: [CORE] },
  { id: 'T25', what: 'record sink: drops the cut argument', file: K, find: '    return this.projection.project(throughSequence);', to: '    return this.projection.project();', tests: [CORE, CLI] },
];
const want = process.argv.slice(2);
const out = [];
function run(t) {
  const r = spawnSync('npx', ['vitest', 'run', ...t.files, '--reporter=dot', '--coverage.enabled=false'], { cwd: path.join(W, t.dir), encoding: 'utf8', timeout: 600000 });
  const text = `${r.stdout}\n${r.stderr}`;
  const m = text.match(/Tests\s+(?:(\d+) failed)?[^\n]*?(\d+) passed/);
  const failed = [...text.matchAll(/(?:FAIL|×)\s+([^\n]+)/g)].map((x) => x[1].trim()).slice(0, 6);
  return { code: r.status, summary: (text.match(/Tests\s+[^\n]+/) ?? ['?'])[0].trim(), failed };
}
if (want[0] === 'BASE') { for (const t of [CLI, CORE]) console.log('BASE', t.dir, JSON.stringify(run(t))); process.exit(0); }
for (const m of M) {
  if (want.length && !want.includes(m.id)) continue;
  const f = path.join(W, m.file); const orig = fs.readFileSync(f, 'utf8');
  const hits = orig.split(m.find).length - 1;
  if (hits !== 1) { console.log(`${m.id} ANCHOR-ERROR hits=${hits}`); out.push({ ...m, result: `anchor hits=${hits}` }); continue; }
  fs.writeFileSync(f, orig.replace(m.find, m.to));
  let killed = false; const details = [];
  // Double-fail rule: a failing run is repeated once; only two failures count as a kill.
  try { for (const t of m.tests) { const r = run(t); details.push(`${t.dir.split('/')[1]}: ${r.summary}`); if (r.code !== 0) { const r2 = run(t); details.push(`rerun: ${r2.summary}`); if (r2.code !== 0) { killed = true; details.push(...r2.failed.slice(0, 3)); } else details.push('FAILED ONCE, PASSED ON THE RERUN'); } } }
  finally { fs.writeFileSync(f, orig); }
  console.log(`${m.id} ${killed ? 'KILLED  ' : 'SURVIVED'} ${m.what} | ${details.join(' | ').slice(0, 400)}`);
  out.push({ id: m.id, what: m.what, killed, details });
}
fs.writeFileSync(process.env.OUT ?? '/rig/out/mut-ts.json', JSON.stringify(out, null, 1));
