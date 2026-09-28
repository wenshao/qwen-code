// S4: after acceptance, corrupt one stored segment / flip bucket versioning, then read.
// env: DB, SRC (out/s3-<tag>.json of a completed run), TAG (generator tag of that run), SO
import fs from 'node:fs';
import * as L from './lib.mjs';

const DB = process.env.DB ?? 'o2b';
const HTTP = 18894;
const src = JSON.parse(fs.readFileSync(`${L.RIG}/out/${process.env.SRC}.json`, 'utf8'));
const TAG = src.tag;
const SO = Number(process.env.SO ?? 5 * 1024 * 1024 + 333);
L.openLog(`s4-${process.env.SRC}`);
const pubId = src.pubs[0].id;
const b = JSON.parse(L.sql(DB, `SELECT binding_json FROM qwen_tool_publication WHERE publication_id='${pubId}'`)[0][0]);
const admission = JSON.parse(L.sql(DB, `SELECT CAST(inline_bytes AS CHAR) FROM qwen_tool_publication_object WHERE publication_id='${pubId}' AND slot_key LIKE 'admission%'`)[0][0]);
const manifestRef = admission.manifestRef;
const expectedIdentity = { tenantId: b.sessionKey.tenantId, sessionId: b.sessionKey.sessionId, turnId: b.turnId, executionCallId: b.executionCallId, callId: b.reference.callId, invocationDigest: b.reference.argsDigest, bindingGeneration: b.bindingGeneration, captureId: b.captureId, revision: 1 };
const w = await L.acquireWriter(HTTP, src.ws, src.sessionId);
L.say('acquire', `${w.status} gen=${w.json.writerGeneration}`);
const read = async (label: string, stream: string, offset: number, length: number) => {
  const r = await L.readRange(HTTP, src.ws, src.sessionId, pubId, w.token, { manifestRef, expectedIdentity, streamId: stream, offset, length });
  const ok = r.status === 200 && r.bytes.equals(L.genSlice(TAG, stream, offset, length));
  L.say(label, `${stream} [${offset}, +${length}] -> ${r.status} ${ok ? 'EXACT' : r.text ?? `${r.bytes.length} B differ`}`);
  return r.status;
};
await read('baseline tail', 'stdout', SO - 4096, 4096);
await read('baseline head', 'stdout', 0, 4096);
const segs = L.objects(DB, pubId).filter((o: any) => o.slot.startsWith('segment:stdout:')).sort((x: any, y: any) => Number(x.slot.split(':')[2]) - Number(y.slot.split(':')[2]));
const last = segs.at(-1);
if (process.env.MODE !== 'versioning') {
const c = await L.oss('/corrupt', { key: last.objectKey, offset: 10 });
L.say('corrupt', `flipped 1 byte of ${last.slot} (${String(c.corrupted).slice(-20)} @${c.at})`);
await read('after corrupt tail', 'stdout', SO - 4096, 4096);
L.say('catalog', L.publications(DB, src.sessionId).map((p: any) => `quarantined=${p.quarantined} phase=${p.phase}`));
L.say('object rows', L.objects(DB, pubId).filter((o: any) => o.state !== 'VERIFIED').map((o: any) => `${o.slot}=${o.state}`));
await read('after corrupt head (untouched segment)', 'stdout', 0, 4096);
await L.oss('/corrupt', { key: last.objectKey, offset: 10 }); // flip back
await read('after restoring bytes', 'stdout', SO - 4096, 4096);
}
await L.oss('/versioning', { status: 'Enabled' });
await read('bucket versioning Enabled', 'stdout', 0, 4096);
await L.oss('/versioning', { status: 'Suspended' });
await read('bucket versioning Suspended', 'stdout', 0, 4096);
await L.oss('/versioning', { status: 'none' });
await read('bucket versioning back to never-enabled', 'stdout', 0, 4096);
process.exit(0);
