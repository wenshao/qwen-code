// S1: one foreground Hosted Shell call through the real stack (Harness bundle ->
// embedded Broker -> separate worker process -> Java publication service ->
// aliyun-sdk-oss -> fake OSS), then independent byte verification.
// env: DB, HTTP, ST (storage letter), SO/SE (bytes), CODE (exit), TAG
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/Users/wenshao/git/qwen-code-pr12894/integration-tests/fake-openai-server.ts';
import { execFileSync } from 'node:child_process';

const DB = process.env.DB ?? 'o2a';
const HTTP = Number(process.env.HTTP ?? 18894);
const BPORT = Number(process.env.BPORT ?? 19894);
const ST = process.env.ST ?? 'a';
const SO = Number(process.env.SO ?? 70 * 1024 * 1024);
const SE = Number(process.env.SE ?? 3 * 1024 * 1024 + 12345);
const CODE = Number(process.env.CODE ?? 0);
const TAG = process.env.TAG ?? `s1-${Date.now()}`;
const RELOAD = process.env.RELOAD === '1';
L.openLog(`s1-${TAG}`);
const NODE = L.NODE22;
const side = `${L.RIG}/run/side-${TAG}.log`;
const seen: string[] = [];
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const receipts = messages.slice(lastUser + 1).filter((x) => x.role === 'tool');
  if (!receipts.length)
    return { toolCalls: [fakeToolCall('run_shell_command', { command: process.env.CMD ?? `${NODE} ${L.RIG}/gen.mjs ${TAG} ${SO} ${SE} ${CODE} ${side}`, ...(process.env.SHELL_TIMEOUT ? { timeout: Number(process.env.SHELL_TIMEOUT) } : {}) }, `call-${TAG}`)] };
  seen.push(JSON.stringify(receipts.at(-1)?.content ?? ''));
  return { content: `done ${TAG}` };
});
const proxy = await L.startBrokerProxy(`http://127.0.0.1:${BPORT}`);
const h = await new L.Harness({ name: `s1-${TAG}`, modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
process.on('exit', () => { try { h.child?.kill('SIGKILL'); } catch {} });
const ws = `ws-${ST}`;
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
const sessionId = await L.createWorkspaceSession(HTTP, ws);
const s = new L.HSession(h, sessionId, L.storeConnection(h, ws, HTTP));
const created = await s.create();
L.say('create', `${created.status} ${JSON.stringify(created.json).slice(0, 200)}`);
const oss0 = await L.oss('/state');
const rss: number[] = [];
const rssTimer = setInterval(() => {
  try {
    const out = execFileSync('/bin/ps', ['-axo', 'pid=,rss=,command='], { encoding: 'utf8' });
    for (const line of out.split('\n')) if (line.includes('dist/cli.js') && !line.includes(' serve ')) rss.push(Number(line.trim().split(/\s+/)[1]));
  } catch {}
}, 500);
const t0 = Date.now();
let r: any;
try { r = await s.prompt(`[[${TAG}]] please run the generator`, Number(process.env.TIMEOUT ?? 600_000)); } catch (e) { r = { status: 'timeout', events: [], terminal: [], status2: await s.status() }; L.say('turn', `did not become idle: ${e}`); }
const compact = (l: string) => l.replace(/\/internal\/runtime-broker\/v1/, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (x) => x.slice(0, 8));
const seenLines = new Map<string, number>();
for (const l of L.ledgerSince(proxy.ledger, 0).map(compact)) seenLines.set(l, (seenLines.get(l) ?? 0) + 1);
for (const [l, n] of seenLines) L.say('broker', `${l}${n > 1 ? ` x${n}` : ''}`);
clearInterval(rssTimer);
L.say('turn', L.summarizeTurn(r));
const oss1 = await L.oss('/state');
L.say('oss', `PUT ${oss1.counters.put - oss0.counters.put} (created ${oss1.counters.putCreated - oss0.counters.putCreated}, exists ${oss1.counters.putExists - oss0.counters.putExists}) GET ${oss1.counters.get - oss0.counters.get} versioning-checks ${oss1.counters.versioning - oss0.counters.versioning} objects+${oss1.objects - oss0.objects} bytes+${oss1.bytes - oss0.bytes}`);
const sideLines = fs.existsSync(side) ? fs.readFileSync(side, 'utf8').trim().split('\n') : [];
L.say('side-effects', `generator ran ${sideLines.length} time(s)`);
for (const line of L.toolTrace(r.events ?? [])) L.say('trace', line);
const resp = (r.events ?? []).flatMap((e: any) => e.data?.record?.message?.parts ?? []).find((p: any) => p.functionResponse)?.functionResponse?.response;
L.say('model-saw', JSON.stringify(resp ?? null).slice(0, 600));
L.say('model-saw-bytes', `${Buffer.byteLength(JSON.stringify(resp ?? null))} B; fake model received tool message ${seen[0]?.length ?? 0} chars`);
const pubs = L.publications(DB, sessionId);
L.say('catalog', pubs);
const pub = pubs[0];
if (pub) {
  const objs = L.objects(DB, pub.id);
  const kinds: Record<string, number> = {};
  for (const o of objs) kinds[`${o.slot.split(':')[0]}/${o.state}/${o.inline ? 'inline' : 'oss'}`] = (kinds[`${o.slot.split(':')[0]}/${o.state}/${o.inline ? 'inline' : 'oss'}`] ?? 0) + 1;
  L.say('objects', kinds);
  for (const stream of ['stdout', 'stderr']) {
    const rebuilt = L.rebuildStream(DB, pub.id, stream);
    const expect = L.genStream(TAG, stream, stream === 'stdout' ? SO : SE);
    L.say(`bytes ${stream}`, `${rebuilt.segments} segments, ${rebuilt.length} B, sha256 ${rebuilt.sha256.slice(0, 16)}… oracle ${expect.slice(0, 16)}… ${rebuilt.sha256 === expect && rebuilt.length === (stream === 'stdout' ? SO : SE) ? 'EXACT' : 'MISMATCH'}`);
  }
}
const status = await s.status();
L.say('status', JSON.stringify(status).slice(0, 300));
// Second owner: detach (seals the Harness writer), then acquire a writer and read tails.
const det = await s.detach();
L.say('detach', det.status);
const w = await L.acquireWriter(HTTP, ws, sessionId);
L.say('acquire', `${w.status} gen=${w.json.writerGeneration}`);
if (pub && resp?.manifestRef) {
  const b = JSON.parse(L.sql(DB, `SELECT binding_json FROM qwen_tool_publication WHERE publication_id='${pub.id}'`)[0][0]);
  const expectedIdentity = {
    tenantId: b.sessionKey.tenantId, sessionId: b.sessionKey.sessionId, turnId: b.turnId, executionCallId: b.executionCallId,
    callId: b.reference.callId, invocationDigest: b.reference.argsDigest, bindingGeneration: b.bindingGeneration, captureId: b.captureId, revision: 1,
  };
  for (const [stream, size] of [['stdout', SO], ['stderr', SE]] as const) {
    for (const [off, len] of [[size - 4096, 4096], [0, 1024], [Math.floor(size / 2) - 777, 1_500_000], [size, 0]] as const) {
      const rr = await L.readRange(HTTP, ws, sessionId, pub.id, w.token, { manifestRef: resp.manifestRef, expectedIdentity, streamId: stream, offset: off, length: len });
      const ok = rr.status === 200 && rr.bytes.equals(L.genSlice(TAG, stream, off, len));
      L.say(`range ${stream}`, `offset=${off} length=${len} -> ${rr.status} ${rr.bytes.length} B ${ok ? 'EXACT' : `DIFF ${rr.text ?? ''}`}`);
    }
    const bad = await L.readRange(HTTP, ws, sessionId, pub.id, w.token, { manifestRef: resp.manifestRef, expectedIdentity, streamId: stream, offset: size - 10, length: 11 });
    L.say(`range ${stream}`, `past end -> ${bad.status} ${bad.text}`);
  }
  const wrong = await L.readRange(HTTP, ws, sessionId, pub.id, w.token, { manifestRef: resp.manifestRef, expectedIdentity: { ...expectedIdentity, captureId: randomUUID() }, streamId: 'stdout', offset: 0, length: 10 });
  L.say('range wrong identity', `${wrong.status} ${wrong.text}`);
  const stale = await L.readRange(HTTP, ws, sessionId, pub.id, 'not-the-writer-token-' + randomUUID(), { manifestRef: resp.manifestRef, expectedIdentity, streamId: 'stdout', offset: 0, length: 10 });
  L.say('range stale writer', `${stale.status} ${stale.text}`);
}
L.say('worker-rss-kb', rss.length ? `max ${Math.max(...rss)} samples ${rss.length}` : 'n/a');
L.say('harness-log', h.log().split('\n').filter((l) => /fail|block|error|retry/i.test(l)).map((l) => l.slice(0, 300)));
fs.writeFileSync(`${L.RIG}/out/s1-${TAG}.json`, JSON.stringify({ sessionId, ws, pub, resp, tag: TAG, SO, SE, CODE }, null, 1));
await h.stop();
await model.close?.();
process.exit(0);
