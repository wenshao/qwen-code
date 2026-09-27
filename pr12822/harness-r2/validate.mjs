// Independent check of recorded real traffic against the OpenAPI spec:
// Ajv (JSON Schema 2020-12, formats on) instead of the PR's networknt
// validator, and real HTTP from a MySQL-backed server with the packaged
// hosted harness instead of MockMvc + FixtureHarness.
// Lines use the same normalized shape as ManagedAgentApiContractTest so they
// can be diffed against contract-known-gaps.txt.
//   node validate.mjs <worktree> <traffic.jsonl> [--by-scenario]
import fs from 'node:fs';
import { createRequire } from 'node:module';

const [wt, traffic, mode] = process.argv.slice(2);
const require = createRequire(`${wt}/package.json`);
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats');
const specPath = `${wt}/packages/sdk-java/managed-agent-server/src/main/resources/openapi/managed-agent-public-api.openapi.json`;
const gapsPath = `${wt}/packages/sdk-java/managed-agent-server/src/test/resources/openapi/contract-known-gaps.txt`;
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true, validateSchema: false });
addFormats(ajv);
ajv.addSchema(spec, 'spec');

const ops = {};
for (const [path, item] of Object.entries(spec.paths))
  for (const [method, op] of Object.entries(item))
    if (op?.operationId) ops[op.operationId] = { path, method, op, status: op['x-qwen-implementation-status'] ?? 'implemented' };
const esc = (s) => s.replaceAll('~', '~0').replaceAll('/', '~1');
const opPtr = (id) => `#/paths/${esc(ops[id].path)}/${ops[id].method}`;
const at = (ptr) => ptr.slice(2).split('/').reduce((n, k) => n?.[k.replaceAll('~1', '/').replaceAll('~0', '~')], spec);
function responsePtr(id, status) {
  const ptr = `${opPtr(id)}/responses/${status}`;
  const node = at(ptr);
  if (!node) return null;
  return node.$ref ?? ptr;
}
const compiled = new Map();
function check(ptr, instance) {
  if (!compiled.has(ptr)) compiled.set(ptr, ajv.getSchema(`spec${ptr}`));
  const validate = compiled.get(ptr);
  return validate(instance) ? [] : validate.errors;
}
function lines(label, errors) {
  return errors.map((e) => {
    const loc = e.instancePath.replace(/\/\d+(?=\/|$)/g, '/*') || '/';
    const prop = e.params?.missingProperty ?? e.params?.additionalProperty;
    return `${label}: ${loc} ${e.keyword}${prop ? ' ' + prop : ''}`;
  });
}

const drift = new Map(); // line -> [scenario notes]
const add = (line, note) => {
  if (!drift.has(line)) drift.set(line, []);
  drift.get(line).push(note);
};
const exercised = new Set();
let exchanges = 0, frames = 0;
for (const entry of fs.readFileSync(traffic, 'utf8').trim().split('\n').map(JSON.parse)) {
  const note = `${entry.op} ${entry.method} ${entry.path.replace(/[0-9a-f-]{36}/g, '{id}')}${entry.note ? ' [' + entry.note + ']' : ''}`;
  exercised.add(entry.op);
  const reqPtr = `${opPtr(entry.op)}/requestBody/content/application~1json/schema`;
  if (entry.request !== null && at(reqPtr)) for (const l of lines(`request ${entry.op}`, check(reqPtr, entry.request))) add(l, note);
  if (entry.kind === 'exchange') {
    exchanges++;
    if (entry.status !== entry.expected)
      add(`response ${entry.op}: expected ${entry.expected}, got ${entry.status}${entry.body?.error?.code ? ' ' + entry.body.error.code : ''}`, note);
    const declared = responsePtr(entry.op, entry.status);
    if (!declared) {
      add(`response ${entry.op}: status ${entry.status} not declared`, note);
      continue;
    }
    const label = `response ${entry.op} ${entry.status}`;
    const schemaPtr = `${declared}/content/application~1json/schema`;
    if (at(schemaPtr)) for (const l of lines(label, check(schemaPtr, entry.body))) add(l, note);
    for (const header of Object.keys(at(declared).headers ?? {}))
      if (!(header.toLowerCase() in entry.headers)) add(`${label}: missing header ${header}`, note);
  } else {
    const schema = entry.op === 'getSessionEvents' ? 'PublicEvent' : 'WebShellEvent';
    const label = `response ${entry.op} 200 text/event-stream`;
    if (entry.status !== 200) add(`${label}: status ${entry.status}`, note);
    const complete = entry.text.slice(0, entry.text.lastIndexOf('\n\n'));
    for (const frame of complete.split('\n\n')) {
      const fields = {};
      for (const line of frame.split('\n')) {
        const colon = line.indexOf(':');
        if (colon > 0) fields[line.slice(0, colon)] = (fields[line.slice(0, colon)] ? fields[line.slice(0, colon)] + '\n' : '') + line.slice(colon + 1).replace(/^ /, '');
      }
      if (!('data' in fields)) continue;
      frames++;
      const event = JSON.parse(fields.data);
      if (String(event.sequence) !== fields.id) add(`${label}: id is not the event sequence`, note);
      if (event.type !== fields.event) add(`${label}: event is not the event type`, note);
      for (const l of lines(label, check(`#/components/schemas/${schema}`, event))) add(l, `${note} {${event.type}}`);
    }
  }
}

const known = new Set(
  fs.readFileSync(gapsPath, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && /^(request|response) /.test(l)),
);
const observed = [...drift.keys()].sort();
const newLines = observed.filter((l) => !known.has(l));
const notSeen = [...known].filter((l) => !drift.has(l)).sort();
const partial = Object.entries(ops).filter(([, o]) => o.status !== 'planned').map(([id]) => id);
console.log(`exchanges=${exchanges} sse_frames=${frames} operations=${[...exercised].filter((o) => partial.includes(o)).length}/${partial.length}`);
console.log(`known request/response gap lines: ${known.size}; observed on real traffic: ${observed.length}; matched: ${observed.length - newLines.length}`);
console.log(`\n== observed but NOT in contract-known-gaps.txt (${newLines.length})`);
for (const l of newLines) console.log(`  + ${l}\n      <- ${[...new Set(drift.get(l))].slice(0, 3).join(' | ')}`);
console.log(`\n== listed but not observed on real traffic (${notSeen.length})`);
for (const l of notSeen) console.log(`  - ${l}`);
if (mode === '--by-scenario') {
  console.log('\n== all observed lines');
  for (const l of observed) console.log(`  ${known.has(l) ? '=' : '+'} ${l}`);
}
