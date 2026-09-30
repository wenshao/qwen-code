// S17 (real OSS): corrupt one stored segment object directly in the bucket, then
// read through the publication service. Also checks anonymous access to the object.
// env: DB, TAG (of an earlier s1 run), SEG (segment index, default 50)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';

const DB = process.env.DB ?? 'o3a', HTTP = 18894;
const TAG = process.env.TAG ?? 'ro-m100';
const SEG = Number(process.env.SEG ?? 50);
const MiB = 1024 * 1024;
L.openLog(`s17-${TAG}`);
const saved = JSON.parse(fs.readFileSync(`${L.RIG}/out/s1-${TAG}.json`, 'utf8'));
const { sessionId, ws, pub, resp } = saved;
const RO = `${L.SP}/realoss`;
const bucket = fs.readFileSync(`${RO}/bucket.txt`, 'utf8').trim();
const oss = (...args: string[]) => execFileSync(`${process.env.HOME}/Install/jdk21/bin/java`, ['-Dhttps.proxyHost=', '-Dhttp.proxyHost=', '-cp', `${RO}/out:${RO}/lib/*`, 'RealOss', ...args], { encoding: 'utf8' }).split('\n').filter((l) => l && !/SLF4J|Commons Logging/.test(l)).join(' | ');
const seg = L.objects(DB, pub.id).find((o: any) => o.slot === `segment:stdout:${SEG}`);
const other = L.objects(DB, pub.id).find((o: any) => o.slot === `segment:stdout:10`);
L.say('object', `${seg.slot} key=${seg.objectKey.replace(/[0-9a-f]{16,}/g, (x: string) => x.slice(0, 8) + '…')} ${seg.length} B state=${seg.state}`);
L.say('anonymous GET', oss('anon', bucket, seg.objectKey));
const w = await L.acquireWriter(HTTP, ws, sessionId);
const b = JSON.parse(L.sql(DB, `SELECT binding_json FROM qwen_tool_publication WHERE publication_id='${pub.id}'`)[0][0]);
const expectedIdentity = {
  tenantId: b.sessionKey.tenantId, sessionId: b.sessionKey.sessionId, turnId: b.turnId, executionCallId: b.executionCallId,
  callId: b.reference.callId, invocationDigest: b.reference.argsDigest, bindingGeneration: b.bindingGeneration, captureId: b.captureId, revision: 1,
};
const read = async (label: string, off: number, len: number) => {
  const rr = await L.readRange(HTTP, ws, sessionId, pub.id, w.token, { manifestRef: resp.manifestRef, expectedIdentity, streamId: 'stdout', offset: off, length: len });
  const ok = rr.status === 200 && rr.bytes.equals(L.genSlice(TAG, 'stdout', off, len));
  L.say(label, `offset=${off} length=${len} -> ${rr.status} ${rr.bytes?.length ?? 0} B ${ok ? 'EXACT' : `NOT EXACT ${String(rr.text ?? '').slice(0, 200)}`}`);
};
await read('before, corrupted segment', SEG * MiB + 100, 4096);
await read('before, other segment', 10 * MiB + 100, 4096);
L.say('corrupt', oss('corrupt', bucket, seg.objectKey));
await read('after, corrupted segment', SEG * MiB + 100, 4096);
await read('after, corrupted segment again', SEG * MiB + 200, 4096);
await read('after, other segment', 10 * MiB + 100, 4096);
L.say('catalog after', JSON.stringify(L.publications(DB, sessionId).map((p: any) => ({ state: p.state, phase: p.phase, quarantined: p.quarantined }))));
L.say('objects after', JSON.stringify(L.objects(DB, pub.id).filter((o: any) => o.slot === seg.slot || o.slot === other.slot).map((o: any) => `${o.slot}=${o.state}`)));
process.exit(0);
