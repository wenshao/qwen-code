// R9: Decision 7's 4th invariant on today's bodies. For every registered body,
// a valid template must parse, and the same record plus the envelope's three
// keys must be refused; also report which envelope keys a body already owns.
import fs from 'node:fs';
const T = process.env.TREE;
const D = `${T}/packages/core/dist/src/managed-runtime`;
const C = `${T}/packages/core/src/managed-runtime/contracts`;
const { MANAGED_EXTENSION_RECORD_BODIES } = await import(`${D}/managed-extension-projection.js`);
const mcp = JSON.parse(fs.readFileSync(`${C}/managed-mcp-record-v1.fixtures.json`, 'utf8'));
const hook = JSON.parse(fs.readFileSync(`${C}/managed-hook-record-v1.fixtures.json`, 'utf8'));
const ext = JSON.parse(fs.readFileSync(`${C}/managed-extension-record-v1.fixtures.json`, 'utf8'));
const templates = { ...mcp.templates, ...hook.templates, monitor_run: ext.monitorRun };
const KEYS = ['operationId', 'revision', 'previousRecordRef'];
for (const [domain, body] of Object.entries(MANAGED_EXTENSION_RECORD_BODIES)) {
  const t = templates[domain];
  let valid;
  try { body.parse(t); valid = 'ok'; } catch (e) { valid = `REFUSED ${e.message.slice(0, 60)}`; }
  const owns = KEYS.filter((k) => k in t);
  const plus = { ...t };
  for (const k of KEYS) if (!(k in plus)) plus[k] = k === 'revision' ? 1 : k === 'previousRecordRef' ? null : 'op-1';
  let withKeys;
  try { body.parse(plus); withKeys = 'ACCEPTED'; } catch (e) { withKeys = `refused (${e.message.slice(0, 50)})`; }
  console.log(JSON.stringify({ domain, template: valid, ownsEnvelopeKeys: owns, plusEnvelopeKeys: withKeys }));
}
