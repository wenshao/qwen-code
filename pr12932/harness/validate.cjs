// Validates captured live Turn responses against the PR's OpenAPI 3.1 contract:
// the status must be declared for the operation, and the body must match the
// schema declared for that status. usage: node validate.cjs <captured.json>...
const path = require('path');
const SP = path.dirname(__dirname);
const req = (m) => require(path.join(SP, 'wt-pr', 'node_modules', m));
const Ajv2020 = req('ajv/dist/2020').default;
const addFormats = req('ajv-formats').default ?? req('ajv-formats');
const doc = require(path.join(SP, 'wt-pr/packages/sdk-java/managed-agent-server/src/main/resources/openapi/managed-agent-public-api.openapi.json'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addFormat('int64', true);
ajv.addFormat('int32', true);
ajv.addSchema({ $id: 'oa', components: doc.components });
const ops = {};
for (const [p, item] of Object.entries(doc.paths)) {
  for (const [m, o] of Object.entries(item)) if (o && o.operationId) ops[o.operationId] = { path: p, method: m, op: o };
}
function schemaRef(opId, status) {
  let resp = ops[opId].op.responses[String(status)];
  if (!resp) return null;
  if (resp.$ref) resp = resp.$ref.split('/').slice(1).reduce((a, k) => a[k], doc);
  const s = resp.content['application/json'].schema;
  return s.$ref ? 'oa' + s.$ref : s;
}
let total = 0;
let bad = 0;
const byKey = {};
for (const file of process.argv.slice(2)) {
  for (const c of require(path.resolve(file))) {
    total++;
    const ref = schemaRef(c.op, c.status);
    let ok;
    let why = '';
    if (!ref) {
      ok = false;
      why = `status ${c.status} not declared for ${c.op}`;
    } else {
      const v = typeof ref === 'string' ? ajv.getSchema(ref) : ajv.compile(ref);
      ok = v(c.body);
      if (!ok) why = JSON.stringify(v.errors.slice(0, 3));
    }
    const key = `${c.op} ${c.status} ${typeof ref === 'string' ? ref.split('/').pop() : '-'}`;
    byKey[key] = byKey[key] ?? { n: 0, bad: 0 };
    byKey[key].n++;
    if (!ok) {
      bad++;
      byKey[key].bad++;
      console.log(`FAIL ${c.op} ${c.status} ${c.label} ${why}`);
    }
  }
}
for (const [k, v] of Object.entries(byKey).sort()) console.log(`${v.bad ? 'FAIL' : 'PASS'}  ${k.padEnd(40)} ${v.n - v.bad}/${v.n}`);
console.log(`${total - bad}/${total} live responses match the declared status and schema`);
// Negative controls: the validator must reject broken bodies.
const neg = [
  ['listTurns', 200, { object: 'list', data: [{ id: 'x', object: 'agent.turn', session_id: 'not-a-uuid', status: 'completed', created_at: 1 }], has_more: false }],
  ['getTurn', 200, { id: 'x', object: 'agent.turn', session_id: '00000000-0000-4000-8000-000000000000', status: 'COMPLETED', created_at: 1 }],
  ['getTurn', 404, { error: { code: 'turn_not_found' } }],
];
let rejected = 0;
for (const [op, st, body] of neg) {
  const v = ajv.getSchema(schemaRef(op, st));
  if (!v(body)) rejected++;
}
console.log(`negative controls rejected: ${rejected}/${neg.length}`);
