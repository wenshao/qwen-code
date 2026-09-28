// S3: fault scenarios on the real stack. Both the worker publication ingress and
// the Harness Session-Store/owner traffic pass through fault-proxy.mjs (18895).
// env: DB, ST, TAG, SO, SE, CODE, CMD, CAPTURE, RULES (proxy rules JSON),
//      OSS_FAULTS (fake OSS fault JSON), HOLD_KILL (path regex: forward, hold reply,
//      SIGKILL Harness, recover with a new Harness), RELOAD_AFTER (1 = detach/load after),
//      HARNESS_WT
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/Users/wenshao/git/qwen-code-pr12894/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'o2b';
const HTTP = 18894, BPORT = 19894, PROXY = 18895, CTRL = 'http://127.0.0.1:18896';
const ST = process.env.ST ?? 's01';
const TAG = process.env.TAG ?? `s3-${Date.now()}`;
const SO = Number(process.env.SO ?? 5 * 1024 * 1024 + 333);
const SE = Number(process.env.SE ?? 1024 * 1024 + 77);
const CODE = Number(process.env.CODE ?? 0);
L.openLog(`s3-${TAG}`);
const side = `${L.RIG}/run/side-${TAG}.log`;
fs.rmSync(side, { force: true });
const ctrl = async (p: string, body?: unknown) => (await fetch(CTRL + p, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })).json();
let modelCalls = 0, continuationCalls = 0;
const model = await startFakeOpenAIServer(async ({ body }) => {
  modelCalls++;
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const receipts = messages.slice(lastUser + 1).filter((x) => x.role === 'tool');
  if (!receipts.length)
    return { toolCalls: [fakeToolCall('run_shell_command', { command: process.env.CMD ?? `${L.NODE22} ${L.RIG}/gen.mjs ${TAG} ${SO} ${SE} ${CODE} ${side}` }, `call-${TAG}`)] };
  continuationCalls++;
  return { content: `done ${TAG}` };
});
const proxy = await L.startBrokerProxy(`http://127.0.0.1:${BPORT}`);
const conn = (h: any) => ({ ...L.storeConnection(h, ws, HTTP), baseUrl: `http://127.0.0.1:${PROXY}` });
let h = await new L.Harness({ name: `s3-${TAG}`, modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
const harnesses = [h];
process.on('exit', () => { for (const x of harnesses) try { x.child?.kill('SIGKILL'); } catch {} });
const ws = `ws-${ST}`;
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
const sessionId = await L.createWorkspaceSession(HTTP, ws);
const s = new L.HSession(h, sessionId, conn(h));
const created = await s.create();
L.say('create', `${created.status}`);
await ctrl('/clear');
await L.oss('/clear-faults');
for (const r of JSON.parse(process.env.RULES ?? '[]')) await ctrl('/rule', r);
for (const f of JSON.parse(process.env.OSS_FAULTS ?? '[]')) await L.oss('/fault', f);
if (process.env.HOLD_KILL) await ctrl('/rule', { match: process.env.HOLD_KILL, action: 'forward-then-hold', count: 1 });
const t0 = Date.now();
const oss0 = await L.oss('/state');
let r: any;
if (process.env.HOLD_KILL) {
  const sub = await s.submit(`[[${TAG}]] run it`);
  L.say('submit', sub.status);
  let held: any = null;
  for (let i = 0; i < 6000 && !held; i++) {
    held = (await ctrl(`/ledger?since=${t0}`)).find((e: any) => String(e.status).endsWith('-held'));
    if (!held) await L.sleep(50);
  }
  L.say('hold', held ? `${held.method} ${held.url.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (x: string) => x.slice(0, 8))} -> ${held.status} (server committed, reply withheld)` : 'never reached');
  h.child.kill('SIGKILL');
  await L.sleep(300);
  L.say('crash', `old Harness SIGKILLed after ${Date.now() - t0} ms; generator runs so far: ${fs.existsSync(side) ? fs.readFileSync(side, 'utf8').trim().split('\n').length : 0}`);
  h = await new L.Harness({ name: `s3-${TAG}-2`, modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
  harnesses.push(h);
  (s as any).h = h;
  (s as any).connection = conn(h);
  const tl = Date.now();
  let load: any;
  do { load = await s.load(); if (load.status !== 200) await L.sleep(2000); } while (load.status !== 200 && Date.now() - tl < 150_000);
  L.say('load', `${load.status} ${load.status === 200 ? '' : JSON.stringify(load.json)} after ${Date.now() - tl} ms`);
  const st = await s.waitIdle(300_000).catch((e: any) => ({ error: String(e) }));
  const events = await s.transcript();
  r = { status: sub.status, status2: st, events, terminal: events.filter((e: any) => e.type.startsWith('turn_')) };
} else {
  try { r = await s.prompt(`[[${TAG}]] run it`, Number(process.env.TIMEOUT ?? 300_000)); }
  catch (e) { r = { status: 'timeout', events: [], terminal: [], status2: await s.status() }; L.say('turn', `not idle: ${e}`); }
}
L.say('turn', L.summarizeTurn(r));
const oss1 = await L.oss('/state');
L.say('oss', `PUT ${oss1.counters.put - oss0.counters.put} created ${oss1.counters.putCreated - oss0.counters.putCreated} exists ${oss1.counters.putExists - oss0.counters.putExists} GET ${oss1.counters.get - oss0.counters.get} faults ${oss1.counters.faults - oss0.counters.faults}`);
L.say('side-effects', `generator ran ${fs.existsSync(side) ? fs.readFileSync(side, 'utf8').trim().split('\n').length : 0} time(s); model calls ${modelCalls}, continuation calls ${continuationCalls}`);
const faults = (await ctrl(`/ledger?since=${t0}`)).filter((e: any) => e.fault || (typeof e.status === 'number' && e.status >= 400) || typeof e.status === 'string');
for (const e of faults.slice(0, 12)) L.say('proxy', `${e.method} ${e.url.replace(/\/internal\/managed-(tool-publications|session-store)\/v1\/sessions\/[^/]+/, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (x: string) => x.slice(0, 8))} -> ${e.status}${e.fault ? ` [${e.fault}]` : ''} ${e.body ?? ''}`.slice(0, 260));
const counts = new Map<string, number>();
for (const e of L.ledgerSince(proxy.ledger, 0).map((l: string) => l.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (x) => x.slice(0, 8)))) counts.set(e, (counts.get(e) ?? 0) + 1);
for (const [l, n] of counts) L.say('broker', `${l}${n > 1 ? ` x${n}` : ''}`);
const pubs = L.publications(DB, sessionId);
L.say('catalog', pubs.map((p: any) => `${p.id.slice(0, 8)} state=${p.state} phase=${p.phase} receiptSeq=${p.receiptSequence} quarantined=${p.quarantined} held=${JSON.stringify(p.held)} used=${JSON.stringify(p.used)}`));
if (pubs[0]) {
  const objs = L.objects(DB, pubs[0].id);
  const kinds: Record<string, number> = {};
  for (const o of objs) { const k = `${o.slot.split(':')[0]}/${o.state}`; kinds[k] = (kinds[k] ?? 0) + 1; }
  L.say('objects', kinds);
  const ops = L.sql(DB, `SELECT operation_id, state, claim_epoch FROM qwen_tool_publication_operation WHERE publication_id='${pubs[0].id}' AND state <> 'SUCCEEDED'`);
  if (ops.length) L.say('ops-not-succeeded', ops);
  if (!process.env.CMD) for (const stream of ['stdout', 'stderr']) {
    try {
      const rb = L.rebuildStream(DB, pubs[0].id, stream);
      const exp = L.genStream(TAG, stream, stream === 'stdout' ? SO : SE);
      L.say(`bytes ${stream}`, `${rb.segments} seg ${rb.length} B ${rb.sha256 === exp ? 'EXACT' : 'differs from oracle (partial?)'}`);
    } catch (e) { L.say(`bytes ${stream}`, String(e)); }
  }
}
const journal = L.sql(DB, `SELECT CAST(record_bytes AS CHAR) FROM qwen_managed_session_journal_tx WHERE session_id='${sessionId}' ORDER BY journal_revision`).map((x: string[]) => x[0]).join('\n');
const kinds = (journal.match(/"kind":"[a-z._]+"/g) ?? []).map((k) => k.slice(8, -1));
const kc: Record<string, number> = {};
for (const k of kinds) kc[k] = (kc[k] ?? 0) + 1;
L.say('journal', kc);
const hist = r.events?.flatMap((e: any) => (e.data?.record?.message?.parts ?? []).filter((p: any) => p.functionResponse).map((p: any) => e.data.record.uuid)) ?? [];
L.say('history', `function responses in transcript: ${hist.length} (${[...new Set(hist)].length} unique uuids)`);
L.say('assistant', JSON.stringify(L.assistantText(r.events ?? [])).slice(0, 120));
L.say('status', JSON.stringify(await s.status()));
if (process.env.RELOAD_AFTER === '1') {
  const d = await s.detach();
  const ld = await s.load();
  L.say('reload', `detach ${d.status} load ${ld.status} ${ld.status === 200 ? '' : JSON.stringify(ld.json)}`);
  await L.sleep(1500);
  L.say('status after reload', JSON.stringify(await s.status()));
}
for (const x of harnesses) L.say(`harness ${x.name}`, x.log().split('\n').filter((l: string) => /fail|block|error|retr/i.test(l)).map((l: string) => l.slice(0, 260)));
fs.writeFileSync(`${L.RIG}/out/s3-${TAG}.json`, JSON.stringify({ sessionId, ws, pubs, tag: TAG }, null, 1));
for (const x of harnesses) await x.stop();
process.exit(0);
