// VERIFICATION RIG ONLY: validate every recorded live response (and accepted request body) of the Action and
// operation routes against the OpenAPI 3.1 document shipped in the server jar.
// usage: node s9-contract.mjs <openapi.json> <http.jsonl> [more http.jsonl...]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/rig/wt/package.json');
const Ajv = require('ajv/dist/2020');
const [docFile, ...logs] = process.argv.slice(2);
const doc = JSON.parse(fs.readFileSync(docFile, 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true, formats: { int64: true, int32: true, 'date-time': true, uri: true, uuid: true, byte: true, binary: true } });
ajv.addSchema({ $id: 'oa', components: doc.components });
const reref = (s) => JSON.parse(JSON.stringify(s).replaceAll('"#/components/', '"oa#/components/'));
const routes = [];
for (const [template, item] of Object.entries(doc.paths)) {
  if (!/actions|operations/.test(template)) continue;
  const re = new RegExp('^' + template.replace(/\{[^}]+\}/g, '[^/?]+') + '(\\?.*)?$');
  for (const [method, op] of Object.entries(item)) if (op.operationId) routes.push({ method: method.toUpperCase(), re, op, template });
}
const stats = new Map();
const failures = [];
let seen = 0;
for (const log of logs) {
  for (const line of fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)) {
    const e = JSON.parse(line);
    const route = routes.find((r) => r.method === e.method && r.re.test(e.path));
    if (!route || /operations\/undefined/.test(e.path)) continue;
    seen++;
    const key = `${route.op.operationId} ${e.status}`;
    const s = stats.get(key) ?? { ok: 0, bad: 0, undocumented: 0, status: route.op['x-qwen-status'] ?? '' };
    let response = route.op.responses?.[String(e.status)];
    if (response?.$ref) response = response.$ref.replace('#/', '').split('/').reduce((o, k) => o?.[k], doc);
    const schema = response?.content?.['application/json']?.schema;
    if (!schema) { s.undocumented++; failures.push({ key, why: 'status not documented', sample: e.json }); stats.set(key, s); continue; }
    const validate = ajv.compile(reref(schema));
    if (validate(e.json)) s.ok++;
    else { s.bad++; failures.push({ key, why: ajv.errorsText(validate.errors).slice(0, 300), sample: e.json }); }
    if (e.status < 300 && e.body !== undefined && route.op.requestBody) {
      const rq = route.op.requestBody.content?.['application/json']?.schema;
      if (rq) { const v = ajv.compile(reref(rq)); if (!v(typeof e.body === 'string' ? JSON.parse(e.body) : e.body)) { s.bad++; failures.push({ key: key + ' (request)', why: ajv.errorsText(v.errors).slice(0, 300), sample: e.body }); } }
    }
    stats.set(key, s);
  }
}
console.log(`# contract ${doc.info.title} ${doc.info.version}: ${seen} recorded exchanges on Action/operation routes`);
let ok = 0, bad = 0, und = 0;
for (const [k, s] of [...stats].sort()) { console.log(`${s.bad || s.undocumented ? 'FAIL' : 'PASS'}  ${k.padEnd(34)} valid=${s.ok} invalid=${s.bad} undocumented=${s.undocumented}`); ok += s.ok; bad += s.bad; und += s.undocumented; }
const seenFail = new Set();
for (const f of failures) { const id = f.key + f.why; if (seenFail.has(id)) continue; seenFail.add(id); console.log(`  !! ${f.key}: ${f.why}\n     ${JSON.stringify(f.sample).slice(0, 300)}`); }
// negative control: a deliberately broken document must be rejected
const neg = ajv.compile(reref(doc.paths['/v1/agents/sessions/{sessionId}/actions/{actionId}'].get.responses['200'].content['application/json'].schema));
console.log(`negative control (Action without state, with an extra field) rejected: ${!neg({ id: 'tool_approval_' + '0'.repeat(32), kind: 'permission', surprise: 1 })}`);
console.log(`== contract: ${ok} valid, ${bad} invalid, ${und} undocumented`);
