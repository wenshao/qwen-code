// Standalone range-read verification for a completed publication whose s1 driver
// crashed before the range phase. manifestRef is recovered from the driver log.
// usage: node range-recheck.mjs <db> <sessionId> <publicationId> <ws> <tag> <SO> <SE> <driverLog>
import * as L from './lib.mjs';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
const [db, sessionId, publicationId, ws, tag, SO, SE, driverLog] = process.argv.slice(2);
const so = Number(SO), se = Number(SE);
const HTTP = 18894;
const rid = fs.readFileSync(driverLog, "utf8").match(/result-[0-9a-f]{32}/)[0];
const mrow = L.sql(db, `SELECT byte_length, sha256 FROM qwen_tool_publication_object WHERE publication_id='${publicationId}' AND slot_key='manifest:1'`)[0]; const manifestRef = { resourceId: rid, kind: "managed-tool-result-manifest", schemaVersion: 1, byteLength: Number(mrow[0]), digest: mrow[1] };
console.log('manifestRef', JSON.stringify(manifestRef));
const w = await L.acquireWriter(HTTP, ws, sessionId);
console.log('acquire', w.status, 'gen=', w.json.writerGeneration);
const b = JSON.parse(L.sql(db, `SELECT binding_json FROM qwen_tool_publication WHERE publication_id='${publicationId}'`)[0][0]);
const expectedIdentity = {
  tenantId: b.sessionKey.tenantId, sessionId: b.sessionKey.sessionId, turnId: b.turnId, executionCallId: b.executionCallId,
  callId: b.reference.callId, invocationDigest: b.reference.argsDigest, bindingGeneration: b.bindingGeneration, captureId: b.captureId, revision: 1,
};
for (const [stream, size] of [['stdout', so], ['stderr', se]]) {
  for (const [off, len] of [[size - 4096, 4096], [0, 1024], [Math.floor(size / 2) - 777, 1500000], [size, 0]]) {
    const rr = await L.readRange(HTTP, ws, sessionId, publicationId, w.token, { manifestRef, expectedIdentity, streamId: stream, offset: off, length: len });
    const ok = rr.status === 200 && rr.bytes.equals(L.genSlice(tag, stream, off, len));
    console.log(`range ${stream}`, `offset=${off} length=${len} -> ${rr.status} ${rr.bytes.length} B ${ok ? 'EXACT' : `DIFF ${rr.text ?? ''}`}`);
  }
  const bad = await L.readRange(HTTP, ws, sessionId, publicationId, w.token, { manifestRef, expectedIdentity, streamId: stream, offset: size - 10, length: 11 });
  console.log(`range ${stream}`, `past end -> ${bad.status} ${bad.text}`);
}
const wrong = await L.readRange(HTTP, ws, sessionId, publicationId, w.token, { manifestRef, expectedIdentity: { ...expectedIdentity, captureId: randomUUID() }, streamId: 'stdout', offset: 0, length: 10 });
console.log('range wrong identity', `${wrong.status} ${wrong.text}`);
const stale = await L.readRange(HTTP, ws, sessionId, publicationId, w.token = w.token, { manifestRef, expectedIdentity, streamId: 'stdout', offset: 0, length: 10 });
console.log('control same-writer', `${stale.status}`);
