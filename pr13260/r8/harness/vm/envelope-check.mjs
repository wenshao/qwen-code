// Host: validate the real error envelopes captured by S15 against the shipped OpenAPI ErrorEnvelope.
// usage: node envelope-check.mjs <s15.json> <openapi-new.json> <openapi-old.json>
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/Users/wenshao/pr13260-rig/wt9/package.json');
const Ajv2020 = require('ajv/dist/2020').default;
const [file, newDoc, oldDoc] = process.argv.slice(2);
const run = JSON.parse(fs.readFileSync(file, 'utf8'));
const envelopeOf = (docPath, strict) => {
  const s = structuredClone(JSON.parse(fs.readFileSync(docPath, 'utf8')).components.schemas.ErrorEnvelope);
  if (strict) { s.additionalProperties = false; s.properties.error.additionalProperties = false; }
  return s;
};
const ajv = new Ajv2020({ strict: false, allErrors: true });
const V = { declared: ajv.compile(envelopeOf(newDoc, false)), strictNew: ajv.compile(envelopeOf(newDoc, true)), strictOld: ajv.compile(envelopeOf(oldDoc, true)) };
const rows = [];
for (const c of run.calls) {
  const err = c.body?.error;
  const row = { storage: c.storage, route: c.route, status: c.status, code: err?.code ?? '-', retryable: err === undefined ? '-' : String(err.retryable), members: err ? Object.keys(err).join(',') : '-' };
  if (err) for (const [k, v] of Object.entries(V)) row[k] = v(c.body) ? 'valid' : `INVALID ${v.errors.map((e) => `${e.instancePath || '/'} ${e.message}${e.params?.additionalProperty ? ` (${e.params.additionalProperty})` : ''}`).join('; ')}`;
  row.sideEffects = c.sideEffects;
  rows.push(row);
}
for (const r of rows) console.log(`${r.storage} ${r.route.padEnd(26)} ${r.status} code=${r.code} retryable=${r.retryable} members=[${r.members}]${r.declared ? ` | 5120e58a schema: ${r.declared}; strict 5120e58a: ${r.strictNew}; strict b40a2801: ${r.strictOld}` : ''} | st-a side effects: ${r.sideEffects}`);
const fenced = rows.filter((r) => r.storage === 'st-a');
const summary = {
  fencedRoutes: fenced.length,
  fencedWorkspaceUnavailableRetryableFalse: fenced.filter((r) => r.status === 409 && r.code === 'workspace_unavailable' && r.retryable === 'false').length,
  fencedOther: fenced.filter((r) => !(r.status === 409 && r.code === 'workspace_unavailable' && r.retryable === 'false')).map((r) => `${r.route}: ${r.status} ${r.code} retryable=${r.retryable}`),
  fencedSideEffects: fenced.filter((r) => r.sideEffects !== 'none').map((r) => `${r.route}: ${r.sideEffects}`),
  declaredValid: rows.filter((r) => r.declared === 'valid').length, strictNewValid: rows.filter((r) => r.strictNew === 'valid').length, strictOldValid: rows.filter((r) => r.strictOld === 'valid').length,
  envelopes: rows.filter((r) => r.declared).length,
  controls: rows.filter((r) => r.storage === 'st-b').map((r) => `${r.route}: ${r.status}`),
};
console.log(JSON.stringify(summary, null, 1));
fs.writeFileSync(file.replace(/\.json$/, '-envelopes.json'), JSON.stringify({ rows, summary }, null, 1));
