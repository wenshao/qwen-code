// Validate recorded real responses against the base and the head spec; report verdict differences.
import { readFileSync } from 'node:fs';
import { loadSpec } from './spec-validator.mjs';
const [baseSpec, headSpec, ...runs] = process.argv.slice(2);
const specs = { base: loadSpec(baseSpec), head: loadSpec(headSpec) };
const norm = (v) => JSON.stringify(v, (k, x) => (typeof x === 'string' && /^[0-9a-f-]{36}$|^(turn|evt)_[0-9a-f]{32}$|^tenant-/.test(x) ? '<id>' : /(_at|At)$/.test(k) ? '<ts>' : x));
const recs = runs.map((f) => JSON.parse(readFileSync(f, 'utf8')).log);
let validated = 0, diff = 0, undeclared = 0, same = 0;
const lines = [];
for (let i = 0; i < recs[0].length; i++) {
  const a = recs[0][i], b = recs[1][i];
  if (a.label !== b.label) throw new Error('sequence mismatch');
  const identical = a.status === b.status && norm(a.json ?? a.text) === norm(b.json ?? b.text);
  same += identical;
  const verdict = {};
  for (const [name, spec] of Object.entries(specs)) {
    const r = spec.response(b.operationId, b.status, b.json);
    verdict[name] = !r.declared ? 'undeclared' : r.schema === false ? 'no-body' : r.ok ? 'valid' : 'INVALID:' + r.errors.slice(0, 2).join('; ');
  }
  if (verdict.head === 'undeclared') undeclared++; else validated++;
  if (verdict.base !== verdict.head) diff++;
  lines.push(`${identical ? '=' : '!'} ${String(b.status).padEnd(4)} ${b.label.padEnd(44)} base-spec:${verdict.base.slice(0, 40).padEnd(12)} head-spec:${verdict.head.slice(0, 40)}`);
}
console.log(lines.join('\n'));
console.log(`\nexchanges=${recs[0].length} base-jar==head-jar(normalized)=${same} validated=${validated} undeclared-status=${undeclared} base/head-spec verdict differences=${diff}`);
