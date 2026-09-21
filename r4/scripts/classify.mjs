// usage: node classify.mjs <arm-root> <label>
// For every surviving mutant: is the deleted guard verdict-bearing? Transpile
// the mutant, then look for one input whose verdict CLASS differs from the
// pristine build (REJECT -> ACCEPT or REJECT -> CRASH).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadArm, event, header, commit, key, verdict } from './fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [root, label] = process.argv.slice(2);
const require = createRequire(path.join(root, 'package.json'));
const esbuild = require('esbuild');
const result = JSON.parse(fs.readFileSync(path.join(here, `mut-${label}.json`), 'utf8'));
const prod = fs.readFileSync(
  path.join(root, 'packages/core/src/managed-runtime/managed-session-records.ts'),
  'utf8',
);
const pristine = await loadArm(root);
const NOFAIL = '\nfunction noFail(_message: string): undefined {\n  return undefined;\n}\n';

function nested(levels, leaf = 'leaf') {
  let v = leaf;
  for (let i = 0; i < levels; i++) v = { n: v };
  return v;
}
class KeyLike {
  tenantId = 't';
  workspaceId = 'w';
  sessionId = 's';
}
const sparse = [1, , 3]; // eslint-disable-line no-sparse-arrays
const withGetter = {};
Object.defineProperty(withGetter, 'boom', { get: () => 1, enumerable: true });
const hidden = {};
Object.defineProperty(hidden, 'h', { value: 1, enumerable: false });
const extraProp = [1, 2];
extraProp.extra = true;

/** [name, (module) => call] — each is REJECTed by the pristine build. */
const WITNESSES = [
  ['assertManagedSessionKey("str")', (m) => m.assertManagedSessionKey('str')],
  ['assertManagedSessionKey([])', (m) => m.assertManagedSessionKey([])],
  ['assertManagedSessionKey(null)', (m) => m.assertManagedSessionKey(null)],
  ['assertManagedSessionKey(new KeyLike())', (m) => m.assertManagedSessionKey(new KeyLike())],
  ['event.payload = new Map()', (m) => m.parseManagedSessionEvent({ ...event('turn.settled'), payload: new Map() })],
  ['target = { f: () => {} }', (m) => m.parseManagedSessionEvent(event('cancel.requested', { target: { f: () => {} } }))],
  ['target = { u: undefined }', (m) => m.parseManagedSessionEvent(event('cancel.requested', { target: { u: undefined } }))],
  ['target = 10n', (m) => m.parseManagedSessionEvent(event('cancel.requested', { target: 10n }))],
  ['target nested one past the depth cap', (m) => m.parseManagedSessionEvent(event('cancel.requested', { target: nested(63) }))],
  ['target = [1, <hole>, 3]', (m) => m.parseManagedSessionEvent(event('cancel.requested', { target: sparse }))],
  ['target = array with an extra own property', (m) => m.parseManagedSessionEvent(event('cancel.requested', { target: extraProp }))],
  ['target = { [Symbol()]: 1 }', (m) => m.parseManagedSessionEvent(event('cancel.requested', { target: { [Symbol('s')]: 1 } }))],
  ['target = { get boom() }', (m) => m.parseManagedSessionEvent(event('cancel.requested', { target: withGetter }))],
  ['target = { non-enumerable h }', (m) => m.parseManagedSessionEvent(event('cancel.requested', { target: hidden }))],
  ['event.subject = { type: "bogus" }', (m) => m.parseManagedSessionEvent({ ...event('turn.settled'), subject: { type: 'bogus' } })],
  ['wake.requested payload.subject = { type: "bogus" }', (m) => m.parseManagedSessionEvent(event('wake.requested', { subject: { type: 'bogus' } }))],
  ['replacedMessageIds = "msg-1"', (m) => m.parseManagedSessionEvent(event('context.compacted', { replacedMessageIds: 'msg-1' }))],
  ['replacedMessageIds = { 0: "msg-1" }', (m) => m.parseManagedSessionEvent(event('context.compacted', { replacedMessageIds: { 0: 'msg-1' } }))],
  ['resources = "res"', (m) => m.parseManagedSessionEvent(event('tool.receipt', { resources: 'res' }))],
  ['resources = null', (m) => m.parseManagedSessionEvent(event('tool.receipt', { resources: null }))],
  ['event.sequence = MAX_SAFE_INTEGER', (m) => m.parseManagedSessionEvent({ ...event('turn.settled'), sequence: Number.MAX_SAFE_INTEGER })],
  ['domain.committed recordRef.schemaVersion = 2', (m) => m.parseManagedSessionEvent(event('domain.committed', { recordRef: { resourceId: 'r', kind: 'managed-goal_state', schemaVersion: 2, byteLength: 1, digest: 'a'.repeat(64) } }))],
  ['managedSessionEventsDigest([])', (m) => m.managedSessionEventsDigest([])],
  ['raw: 65 nested arrays', (m) => m.parseManagedSessionRecordJson('['.repeat(65) + ']'.repeat(65), 4096)],
  ['raw: 65 nested objects', (m) => m.parseManagedSessionRecordJson('{"a":'.repeat(65) + '1' + '}'.repeat(65), 4096)],
  ['raw: {"a":"\\u12G4"}', (m) => m.parseManagedSessionRecordJson('{"a":"\\u12G4"}', 4096)],
  ['raw: {"\\u12G4":1,"x":1}', (m) => m.parseManagedSessionRecordJson('{"\\u12G4":1,"x":1}', 4096)],
  ['raw: {"a":"\\q"}', (m) => m.parseManagedSessionRecordJson('{"a":"\\q"}', 4096)],
  ['raw: {"a":"unterminated', (m) => m.parseManagedSessionRecordJson('{"a":"unterminated', 4096)],
  ['raw: {"a":1,"b":"\\', (m) => m.parseManagedSessionRecordJson('{"a":1,"b":"\\', 4096)],
  ['header(null)', (m) => m.parseManagedSessionHeader(null)],
  ['commit("x")', (m) => m.parseManagedSessionCommitMarker('x')],
  ['header.sessionKey = new KeyLike()', (m) => m.parseManagedSessionHeader(header({ sessionKey: new KeyLike() }))],
  ['commit with Date', (m) => m.parseManagedSessionCommitMarker({ ...commit(), operation: new Date(0) })],
];
// keep only the witnesses this arm's pristine build rejects (an older arm may lack a guard)
for (let i = WITNESSES.length - 1; i >= 0; i--) {
  const r = verdict(pristine, () => WITNESSES[i][1](pristine));
  if (r.v !== 'REJECT') {
    console.error(`(witness "${WITNESSES[i][0]}" is ${r.v} on this arm — skipped)`);
    WITNESSES.splice(i, 1);
  }
}

const survivors = result.sites.filter((s) => !s.killed);
const outDir = path.join(here, 'mutjs', label);
fs.rmSync(outDir, { recursive: true, force: true });
const rows = [];
for (const site of survivors) {
  const ts = prod.slice(0, site.index) + 'noFail(' + prod.slice(site.index + 5) + NOFAIL;
  const js = esbuild.transformSync(ts, { loader: 'ts', format: 'esm', target: 'node22' }).code;
  const dir = path.join(outDir, site.id, 'packages/core/dist/src');
  fs.mkdirSync(path.join(dir, 'managed-runtime'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'utils'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'managed-runtime/managed-session-records.js'), js);
  const textUtils = path.join(root, 'packages/core/dist/src/utils/textUtils.js');
  if (fs.existsSync(textUtils)) fs.copyFileSync(textUtils, path.join(dir, 'utils/textUtils.js'));
  fs.writeFileSync(path.join(outDir, site.id, 'package.json'), '{"type":"module"}');
  const mutant = await import(
    pathToFileURL(path.join(dir, 'managed-runtime/managed-session-records.js')).href
  );
  let witness = null;
  let messageOnly = null;
  for (const [name, call] of WITNESSES) {
    const p = verdict(pristine, () => call(pristine));
    const q = verdict(mutant, () => call(mutant));
    // mutant module has its own error class: classify by name
    const qv = q.v === 'ACCEPT' ? 'ACCEPT' : q.errorName === 'ManagedSessionRecordError' ? 'REJECT' : 'CRASH';
    if (qv !== 'REJECT') {
      witness = { name, to: qv, detail: qv === 'CRASH' ? `${q.errorName}: ${q.message}`.slice(0, 80) : '' };
      break;
    }
    if (!messageOnly && q.message !== p.message) {
      messageOnly = { name, from: p.message.slice(0, 60), to: q.message.slice(0, 60) };
    }
  }
  rows.push({ ...site, witness, messageOnly });
}
fs.writeFileSync(path.join(here, `classify-${label}.json`), JSON.stringify(rows, null, 1));
for (const r of rows) {
  const verdictText = r.witness
    ? `LIVE   ${r.witness.name}  REJECT -> ${r.witness.to} ${r.witness.detail}`
    : r.messageOnly
      ? `MSG    still rejected by a later guard: ${r.messageOnly.name}`
      : 'NOWIT  no witness in corpus';
  console.log(`${r.id} L${String(r.line).padEnd(5)} ${r.fn.padEnd(28)} ${verdictText}`);
}
