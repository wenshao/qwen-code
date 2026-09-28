import fs from 'node:fs';
import * as L from './lib.mjs';
const DB = process.env.DB ?? 'o2b', HTTP = 18894;
const src = JSON.parse(fs.readFileSync(`${L.RIG}/out/${process.env.SRC ?? 's3-fd'}.json`, 'utf8'));
const pubId = src.pubs[0].id;
const b = JSON.parse(L.sql(DB, `SELECT binding_json FROM qwen_tool_publication WHERE publication_id='${pubId}'`)[0][0]);
const admission = JSON.parse(Buffer.from(L.sql(DB, `SELECT HEX(inline_bytes) FROM qwen_tool_publication_object WHERE publication_id='${pubId}' AND slot_key LIKE 'admission%'`)[0][0], 'hex').toString('utf8'));
const expectedIdentity = { tenantId: b.sessionKey.tenantId, sessionId: b.sessionKey.sessionId, turnId: b.turnId, executionCallId: b.executionCallId, callId: b.reference.callId, invocationDigest: b.reference.argsDigest, bindingGeneration: b.bindingGeneration, captureId: b.captureId, revision: 1 };
const w = await L.acquireWriter(HTTP, src.ws, src.sessionId);
for (const [label, offset, length] of [['length 2^32+1', 0, 4294967297], ['length "16"', 0, '16'], ['length 10.9', 0, 10.9], ['offset "5"', '5', 3], ['length -1', 0, -1]] as const) {
  const r = await L.readRange(HTTP, src.ws, src.sessionId, pubId, w.token, { manifestRef: admission.manifestRef, expectedIdentity, streamId: 'stdout', offset, length });
  console.log(`${label.padEnd(16)} -> HTTP ${r.status}, ${r.status === 200 ? `${r.bytes.length} byte(s) returned` : r.text?.slice(0, 80)}`);
}
process.exit(0);
