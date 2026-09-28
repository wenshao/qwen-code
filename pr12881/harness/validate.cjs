// Validates captured live responses against the PR's OpenAPI 3.1 components.
const path = require('path');
const SP = path.dirname(__dirname);
const req = (m) => require(path.join(SP, 'wt-base', 'node_modules', m));
const Ajv2020 = req('ajv/dist/2020').default;
const addFormats = req('ajv-formats').default ?? req('ajv-formats');
const doc = require(path.join(SP, 'wt-pr/packages/sdk-java/managed-agent-server/src/main/resources/openapi/managed-agent-public-api.openapi.json'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addFormat('int64', true); ajv.addFormat('int32', true);
ajv.addSchema({ $id: 'oa', components: doc.components });
const captured = require(process.argv[2]);
let bad = 0;
for (const c of captured) {
  const schema = c.schema === 'Error' ? 'ErrorEnvelope' : c.schema;
  const v = ajv.getSchema(`oa#/components/schemas/${schema}`);
  const ok = v(c.body);
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(c.status).padEnd(3)} ${c.label.padEnd(22)} ${schema}${ok ? '' : '  ' + JSON.stringify(v.errors.slice(0, 3))}`);
}
console.log(`${captured.length - bad}/${captured.length} responses match the published schema`);
