// S7: O2 Shell output stored in a real Aliyun OSS bucket (temporary, private, deleted afterwards).
// Deployed stack with PUB=real -> Shell Session publishes 3 segments to real OSS -> offline + fence -> capture with the
// maintenance jar reading real OSS (W1_OSS_*), no hosts file or private trust store -> fresh verify (no OSS needed) ->
// one segment corrupted / deleted in the real bucket -> new captures must refuse; original bytes restored afterwards.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as L from './lib.mjs';
import * as W from './w1b.mjs';
import * as P from './pop.mjs';
L.openLog('s7-real-oss');
const { say } = L;
const real = Object.fromEntries(fs.readFileSync('/var/lib/qwen-w1b/oss-real.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const BUCKET = real.OSS_BUCKET; const redact = (s) => String(s).replaceAll(BUCKET, 'qwen-pr13138-verify-xxxxxx');
const admin = (...args) => { const r = spawnSync('/opt/qwen/jdk/bin/java', ['-cp', '/var/lib/qwen-w1b/oss-lib/*', '/Users/wenshao/pr13138-rig/vm/realoss/OssAdmin.java', ...args], { env: { PATH: '/usr/bin:/bin', OSS_ACCESS_KEY_ID: real.OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET: real.OSS_ACCESS_KEY_SECRET }, encoding: 'utf8' }); return redact(`${r.stdout}${r.stderr}`.trim().split('\n').at(-1)); };
const W1_REAL = { W1_OSS_ENDPOINT: 'https://oss-cn-hangzhou.aliyuncs.com', W1_OSS_REGION: 'cn-hangzhou', W1_OSS_BUCKET: BUCKET, OSS_ACCESS_KEY_ID: real.OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET: real.OSS_ACCESS_KEY_SECRET };
say(L.hostFacts()); say(`   bucket (redacted): ${redact(BUCKET)}; before: ${admin('info', BUCKET)}`);
await P.rollout(['a', 'b']);
const rig = await L.startRig('s7');
const { S } = await P.populate(rig);
const pub = L.publications(S.O1.sessionId)[0];
const objs = pub ? L.pubObjects(pub.id) : [];
say(`   O1 publication ${pub?.phase}: ${objs.filter((o) => o.objectKey).map((o) => `${o.slot}=${o.length}B`).join(' ')}; seals ${pub ? L.pubSeals(pub.id).map((s) => `${s.stream}=${s.segments}/${s.length}`).join(' ') : '-'}`);
say(`   bucket after the Turn: ${admin('info', BUCKET)}`);
const { fence, revision } = await P.offlineAndFence(rig);
const ids = W.members('a').map((m) => m.id);
const capture = async (name) => { const { bundle } = W.prepareBundle(`s7-${name}`, { sessions: ids }); const req = W.captureRequest({ fence, revision, bundle }); const r = await W.w1b('capture', req, { label: `capture-${name}`, extraEnv: W1_REAL }); return { req, r, bundle }; };
say('== capture reading the real bucket');
const c = await capture('real');
const segAssets = c.r.code === 0 ? fs.readFileSync(`${c.bundle}/.w1-recovery/assets.ndjson`, 'utf8').trim().split('\n').map((l) => JSON.parse(l).metadata).filter((m) => m.type === 'publicationObject') : [];
say(`   publication objects in the bundle: ${segAssets.map((m) => `${m.object.slotKey ?? '?'}:${m.object.byteLength}B`).join(' ') || '-'}`);
const v = await W.w1b('verify', W.verifyRequest(c.req), { label: 'verify-real' });
{
  const { bundle } = W.prepareBundle('s7-wrong-key', { sessions: ids });
  const req = W.captureRequest({ fence, revision, bundle });
  const r = await W.w1b('capture', req, { label: 'capture-wrong-key', extraEnv: { ...W1_REAL, OSS_ACCESS_KEY_SECRET: 'wrong-secret-for-verification' } });
  say(`   wrong secret: ${W.opStr(W.opRow(req.operationId))}`);
  var wrongKey = W.summary(r);
}
const seg = objs.find((o) => o.slot === 'segment:stdout:1');
const rows = [{ id: 'real-bucket', capture: W.summary(c.r), verify: W.summary(v) }, { id: 'wrong-secret', capture: wrongKey }];
if (seg) {
  admin('save', BUCKET, seg.objectKey, '/var/lib/qwen-w1b/seg1.orig');
  say(`== segment:stdout:1 corrupted in the real bucket: ${admin('corrupt', BUCKET, seg.objectKey)}`);
  const c2 = await capture('corrupt'); say(`   ${W.opStr(W.opRow(c2.req.operationId))}`);
  rows.push({ id: 'segment-corrupted', capture: W.summary(c2.r) });
  say(`== segment:stdout:1 deleted from the real bucket: ${admin('delete', BUCKET, seg.objectKey)}`);
  const c3 = await capture('deleted'); say(`   ${W.opStr(W.opRow(c3.req.operationId))}`);
  rows.push({ id: 'segment-deleted', capture: W.summary(c3.r) });
  say(`   original bytes put back: ${admin('restore', BUCKET, seg.objectKey, '/var/lib/qwen-w1b/seg1.orig')}`);
  const c4 = await capture('restored'); rows.push({ id: 'restored', capture: W.summary(c4.r) });
  const v2 = await W.w1b('verify', W.verifyRequest(c.req), { label: 'verify-real-after' });
  rows.push({ id: 'first-bundle-reverified', verify: W.summary(v2) });
}
say('== summary');
for (const x of rows) say(`   ${x.id.padEnd(24)} ${x.capture ? `capture: ${x.capture.slice(0, 120)}` : ''}${x.verify ? ` verify: ${x.verify.slice(0, 120)}` : ''}`);
fs.writeFileSync(`${L.OUT}/s7-real-oss.json`, JSON.stringify(rows, null, 1));
await rig.stop(); say('S7-DONE');
