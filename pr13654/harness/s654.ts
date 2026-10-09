// PR #13654 real-stack scenario: one Hosted Workspace Session, the fake model
// asks for one Shell command, the worker publishes its captured output through
// the fault proxy (18655) to the Spring publication ingress (18654), which
// stores objects in the fake OSS (TLS :443, admin 18657).
// env: DB, ST, TAG, SO, SE, CODE, CMD, TIMEOUT
//      HOLD=1           hold every object GET (readback) before the prompt
//      HOLD_MS          release the hold this long after the first POST answer (default 8000)
//      HOLD_ACTION      'release' (default) | 'corrupt-then-release' | 'restart-then-release' | 'none'
//      RESTART_ARGS     env assignments for up.sh on restart (e.g. "ASYNC=0")
//      RULES / OSS_FAULTS  JSON arrays for the fault proxy / fake OSS
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/Users/wenshao/git/qwen-code-pr13654/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'p654a';
const HTTP = Number(process.env.HTTP_PORT ?? 18654), BPORT = Number(process.env.BROKER_PORT ?? 19654), PROXY = Number(process.env.PUB_PORT ?? 18655), CTRL = `http://127.0.0.1:${Number(process.env.PUB_PORT ?? 18655) + 1}`;
const ST = process.env.ST ?? 's01';
const TAG = process.env.TAG ?? `s-${Date.now()}`;
const SO = Number(process.env.SO ?? 5 * 1024 * 1024 + 333);
const SE = Number(process.env.SE ?? 1024 * 1024 + 77);
const CODE = Number(process.env.CODE ?? 0);
L.openLog(`s654-${TAG}`);
const side = `${L.RIG}/run/side-${TAG}.log`;
fs.rmSync(side, { force: true });
const ctrl = async (p: string, body?: unknown) => (await fetch(CTRL + p, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })).json();
let modelCalls = 0, continuationCalls = 0;
let toolResultText = '';
const model = await startFakeOpenAIServer(async ({ body }) => {
  modelCalls++;
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const receipts = messages.slice(lastUser + 1).filter((x) => x.role === 'tool');
  if (!receipts.length)
    return { toolCalls: [fakeToolCall('run_shell_command', { command: process.env.CMD ?? `${L.NODE22} ${L.RIG}/gen.mjs ${TAG} ${SO} ${SE} ${CODE} ${side}` }, `call-${TAG}`)] };
  continuationCalls++;
  toolResultText = typeof receipts[0].content === 'string' ? receipts[0].content : JSON.stringify(receipts[0].content);
  return { content: `done ${TAG}` };
});
const proxy = await L.startBrokerProxy(`http://127.0.0.1:${BPORT}`);
const ws = `ws-${ST}`;
const conn = (h: any) => ({ ...L.storeConnection(h, ws, HTTP), baseUrl: `http://127.0.0.1:${PROXY}` });
const h = await new L.Harness({ name: `s654-${TAG}`, modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
process.on('exit', () => { try { h.child?.kill('SIGKILL'); } catch {} });
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
const sessionId = await L.createWorkspaceSession(HTTP, ws);
const s = new L.HSession(h, sessionId, conn(h));
const created = await s.create();
L.say('create', `${created.status} session=${sessionId.slice(0, 8)}`);
await ctrl('/clear');
await L.oss('/clear-faults');
for (const r of JSON.parse(process.env.RULES ?? '[]')) await ctrl('/rule', r);
for (const f of JSON.parse(process.env.OSS_FAULTS ?? '[]')) await L.oss('/fault', f);
const HOLD = process.env.HOLD === '1';
await ctrl('/capture', process.env.HOLD_ACTION === 'replay' ? { match: '/publications/.+/(segments|resources)/' } : {});
if (process.env.GET_BPS) await L.oss('/throttle', { getBps: Number(process.env.GET_BPS) });
else await L.oss('/throttle', { getBps: 0 });
if (HOLD) await L.oss('/hold-gets', { on: true });
const t0 = Date.now();
const oss0 = await L.oss('/state');
const pubPath = (u: string) => u.replace(/^.*\/publications\/[^/]+/, '').replace(/\?.*$/, '');
let holdNote = '';
let r: any;
const sub = await s.submit(`[[${TAG}]] run it`);
L.say('submit', String(sub.status));
if (HOLD) try {
  // Wait for the first answered publication POST while readback is held.
  let first: any = null;
  const holdWait = Number(process.env.HOLD_WAIT ?? 120000);
  for (let i = 0; i < holdWait / 100 && !first; i++) {
    first = (await ctrl(`/ledger?since=${t0}`)).find((e: any) => e.url.includes(sessionId) && e.method === 'POST' && /\/publications\/.+\/(segments|resources|streams|finish)/.test(e.url) && e.status !== null);
    if (!first) await L.sleep(100);
  }
  if (!first) {
    holdNote = `no publication POST answered within ${holdWait / 1000} s while readback was held`;
  } else {
    holdNote = `first POST ${pubPath(first.url)} answered ${first.status} state=${first.state ?? '-'} in ${first.ms} ms (async header ${first.async ?? 'absent'}) while readback held`;
  }
  L.say('hold', holdNote);
  // Keep holding, then report the durable rows while the client is still waiting.
  const holdMs = Number(process.env.HOLD_MS ?? 8000);
  await L.sleep(holdMs);
  const st = await L.oss('/state');
  const ledger = await ctrl(`/ledger?since=${t0}`);
  const posts = ledger.filter((e: any) => e.method === 'POST' && /\/publications\//.test(e.url));
  const polls = ledger.filter((e: any) => e.method === 'GET' && /\/operations\//.test(e.url));
  L.say('during-hold', `after ${holdMs} ms: waiting GETs at OSS ${st.waitingGets}; publication POSTs answered ${posts.filter((e: any) => e.status !== null).length} (${[...new Set(posts.map((e: any) => `${e.status}/${e.state ?? '-'}`))].join(',')}), unanswered ${posts.filter((e: any) => e.status === null).length}; status polls ${polls.length} (${[...new Set(polls.map((e: any) => e.state ?? e.status))].join(',')})`);
  const pubs0 = L.publications(DB, sessionId);
  if (pubs0[0]) {
    let opsNow: string[][];
    try { opsNow = L.sql(DB, `SELECT CONCAT(operation_id, ' ', slot_key, ' ', state, ' mode=', execution_mode, ' ready=', verification_ready, ' epoch=', claim_epoch, ' claim=', IF(claim_until IS NULL, 'none', IF(claim_until > CURRENT_TIMESTAMP(6), 'live', 'lapsed')), ' input=', IF(verification_request_json IS NULL, 'null', CONCAT(CHAR_LENGTH(verification_request_json), 'B'))) FROM qwen_tool_publication_operation WHERE publication_id='${pubs0[0].id}' ORDER BY created_at`); }
    catch { opsNow = L.sql(DB, `SELECT CONCAT(operation_id, ' ', slot_key, ' ', state, ' (pre-V54 schema) epoch=', claim_epoch, ' claim=', IF(claim_until IS NULL, 'none', IF(claim_until > CURRENT_TIMESTAMP(6), 'live', 'lapsed'))) FROM qwen_tool_publication_operation WHERE publication_id='${pubs0[0].id}' ORDER BY created_at`); }
    L.say('during-hold ops', opsNow.map((x: string[]) => x[0]));
    L.say('during-hold objects', L.objects(DB, pubs0[0].id).map((o: any) => `${o.slot}=${o.state}`).join(' '));
  }
  const action = process.env.HOLD_ACTION ?? 'release';
  if (action === 'replay') {
    // Let the first operation finish, re-hold readback so the publication stays open,
    // replay the first POST byte-for-byte, then corrupt that object and let the real reads continue.
    const firstOp = first?.op;
    await L.oss('/hold-gets', { on: false });
    const pubId = L.publications(DB, sessionId)[0]?.id;
    let state = '';
    for (let i = 0; i < 600 && state !== 'SUCCEEDED'; i++) {
      state = L.sql(DB, `SELECT state FROM qwen_tool_publication_operation WHERE publication_id='${pubId}' AND operation_id='${firstOp}'`)[0]?.[0] ?? '';
      if (state !== 'SUCCEEDED') await L.sleep(50);
    }
    await L.oss('/hold-gets', { on: true });
    L.say('replay', `${firstOp} is ${state}; readback held again`);
    await L.sleep(1500);
    const cap = (await ctrl('/captured')).find((c: any) => c.headers['x-qwen-tool-publication-operation'] === firstOp && c.method === 'POST');
    const g0 = (await L.oss('/state')).counters.get;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(cap.headers as Record<string, string>)) if (!['host', 'content-length', 'connection'].includes(k)) headers[k] = v;
    const tr = Date.now();
    const rr = await fetch(`http://127.0.0.1:${HTTP}${cap.url}`, { method: 'POST', headers, body: Buffer.from(cap.body, 'base64') });
    const rtext = await rr.text();
    const g1 = (await L.oss('/state')).counters.get;
    const orig = L.sql(DB, `SELECT receipt_json FROM qwen_tool_publication_operation WHERE publication_id='${pubId}' AND operation_id='${firstOp}'`)[0]?.[0] ?? '';
    let same = false;
    try { const got = JSON.parse(rtext); same = JSON.stringify(got.receipt ?? got) === JSON.stringify(JSON.parse(orig)); } catch {}
    L.say('replay', `replayed POST ${pubPath(cap.url)} (async header ${headers['x-qwen-tool-publication-async'] ?? 'absent'}) -> ${rr.status} in ${Date.now() - tr} ms; object GETs during replay ${g1 - g0}; body equals stored receipt: ${same}; body ${rtext.slice(0, 160)}`);
    const objKey = L.objects(DB, pubId).find((o: any) => o.op === firstOp)?.objectKey;
    const c = await L.oss('/corrupt', { key: objKey });
    L.say('corrupt', `flipped one byte of the replayed operation's object ${c.corrupted ? '…' + c.corrupted.slice(-12) : 'nothing'} at ${c.at}`);
  }
  if (action === 'corrupt-then-release') {
    const keys = (await L.oss('/state?keys=1')).keys as Array<{ key: string }>;
    const target = keys.filter((k) => k.key.includes(pubs0[0]?.id ?? '\u0000')).at(-1);
    const c = await L.oss('/corrupt', { key: target?.key });
    L.say('corrupt', `flipped one byte of ${c.corrupted ? c.corrupted.replace(/^.*\//, '…/') : 'nothing'} at ${c.at}`);
  }
  if (action === 'restart-then-release') {
    const tr = Date.now();
    execFileSync(`${L.RIG}/stop-spring.sh`, { env: { ...process.env, SIG: '-9', KEEP_KIDS: '1' }, stdio: 'inherit' });
    L.say('restart', `Spring SIGKILLed (workers kept) in ${Date.now() - tr} ms`);
    if (process.env.RELEASE_BEFORE_RESTART === '1') { await L.oss('/hold-gets', { on: false }); }
    const env: Record<string, string> = { ...process.env as Record<string, string>, DB };
    for (const kv of (process.env.RESTART_ARGS ?? '').split(' ').filter(Boolean)) { const [k, v] = kv.split('='); env[k] = v; }
    const out = execFileSync(`${L.RIG}/up.sh`, [process.env.JAR_ARM ?? 'head', process.env.WORKER_WT ?? L.WT], { env, encoding: 'utf8' });
    L.say('restart', `${out.trim().split('\n').at(-1)?.slice(0, 160)} after ${Date.now() - tr} ms`);
  }
  if (action !== 'none') {
    const rel = await L.oss('/hold-gets', { on: false });
    L.say('release', `released ${rel.released} held GET(s) at +${Date.now() - t0} ms`);
  }
} catch (e) {
  L.say('driver-error', String((e as Error)?.stack ?? e).slice(0, 400));
} finally {
  const st = await L.oss('/state');
  if (st.holdGets) { const rel = await L.oss('/hold-gets', { on: false }); L.say('release', `safety release of ${rel.released} held GET(s)`); }
}
try {
  const st = await s.waitIdle(Number(process.env.TIMEOUT ?? 600_000));
  const events = await s.transcript();
  const mine = events.filter((e: any) => e.promptId === sub.promptId);
  r = { ...sub, ms: Date.now() - t0, status2: st, events: mine, terminal: mine.filter((e: any) => e.type.startsWith('turn_')) };
} catch (e) {
  r = { status: 'timeout', events: [], terminal: [], status2: await s.status().catch(() => null) };
  L.say('turn', `not idle: ${e}`);
}
L.say('turn', L.summarizeTurn(r));
L.say('tool', L.toolTrace(r.events ?? []).slice(-2));
L.say('model-saw', toolResultText.replace(/\s+/g, ' ').slice(0, 220));
const oss1 = await L.oss('/state');
L.say('oss', `PUT ${oss1.counters.put - oss0.counters.put} GET ${oss1.counters.get - oss0.counters.get} faults ${oss1.counters.faults - oss0.counters.faults}`);
const sideLines = fs.existsSync(side) ? fs.readFileSync(side, 'utf8').trim().split('\n') : [];
const starts = sideLines.filter((l) => !l.includes(' end '));
const ends = sideLines.filter((l) => l.includes(' end '));
const genMs = starts[0] && ends[0] ? Number(ends[0].split(' ').at(-1)) - Number(starts[0].split(' ').at(-1)) : NaN;
L.say('side-effects', `generator ran ${starts.length} time(s), wrote all output in ${genMs} ms; model calls ${modelCalls}, continuation calls ${continuationCalls}`);
const ledger = await ctrl(`/ledger?since=${t0}`);
const pub = ledger.filter((e: any) => /\/internal\/managed-tool-publications\//.test(e.url) && /\/publications\//.test(e.url) && e.url.includes(sessionId));
const posts = pub.filter((e: any) => e.method === 'POST' && !/\/recover$/.test(e.url));
const polls = pub.filter((e: any) => e.method === 'GET' && /\/operations\//.test(e.url));
const recovers = pub.filter((e: any) => /\/recover$/.test(e.url));
const byStatus: Record<string, number> = {};
for (const e of posts) byStatus[`${e.status}${e.state ? '/' + e.state : ''}`] = (byStatus[`${e.status}${e.state ? '/' + e.state : ''}`] ?? 0) + 1;
const pollStates: Record<string, number> = {};
for (const e of polls) pollStates[String(e.state ?? e.status)] = (pollStates[String(e.state ?? e.status)] ?? 0) + 1;
const ms = posts.map((e: any) => e.ms ?? 0).sort((a: number, b: number) => a - b);
const pct = (p: number) => ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : NaN;
const asyncHdr = [...new Set(posts.map((e: any) => e.async ?? 'absent'))].join(',');
const firstPub = pub[0]?.t, lastPub = pub.length ? Math.max(...pub.map((e: any) => e.t + (e.ms ?? 0))) : NaN;
L.say('requests', `POST ${posts.length} ${JSON.stringify(byStatus)} async-header=${asyncHdr}; status polls ${polls.length} ${JSON.stringify(pollStates)}; recover ${recovers.length}`);
L.say('request-latency', `POST ms p50 ${pct(0.5)} p90 ${pct(0.9)} max ${ms.at(-1)} sum ${ms.reduce((a: number, b: number) => a + b, 0)}; publication window ${lastPub - firstPub} ms`);
for (const e of pub.filter((e: any) => /\/(seal|finish|prefix|recover)$/.test(e.url) || /manifest|page/.test(e.url))) L.say('proxy-timing', `${e.method} ${pubPath(e.url)} -> ${e.status}${e.state ? '/' + e.state : ''} in ${e.ms ?? '?'} ms`);
for (const e of pub.filter((e: any) => (typeof e.status === 'number' && e.status >= 400) || typeof e.status === 'string' || e.state === 'FAILED').slice(0, 12)) L.say('proxy-error', `${e.method} ${pubPath(e.url)} -> ${e.status}${e.state ? '/' + e.state : ''} ${e.body ?? ''}`.slice(0, 260));
const pubs = L.publications(DB, sessionId);
L.say('catalog', pubs.map((p: any) => `${p.id.slice(0, 8)} state=${p.state} phase=${p.phase} receiptSeq=${p.receiptSequence} quarantined=${p.quarantined} held=${JSON.stringify(p.held)}`));
if (pubs[0]) {
  const objs = L.objects(DB, pubs[0].id);
  const kinds: Record<string, number> = {};
  for (const o of objs) { const k = `${o.slot.split(':')[0]}/${o.state}`; kinds[k] = (kinds[k] ?? 0) + 1; }
  L.say('objects', kinds);
  let modes: string[][] = [];
  try { modes = L.sql(DB, `SELECT CONCAT(execution_mode, '/', state, IF(failure_code IS NULL, '', CONCAT(' ', failure_status, ' ', failure_code))), COUNT(*) FROM qwen_tool_publication_operation WHERE publication_id='${pubs[0].id}' GROUP BY 1`); } catch { modes = L.sql(DB, `SELECT CONCAT('n/a/', state), COUNT(*) FROM qwen_tool_publication_operation WHERE publication_id='${pubs[0].id}' GROUP BY 1`); }
  L.say('ops', modes.map((m) => `${m[0]} x${m[1]}`).join('; '));
  L.say('ops-epochs', L.sql(DB, `SELECT CONCAT('max epoch ', MAX(claim_epoch), ', ops with epoch>1: ', SUM(claim_epoch > 1)) FROM qwen_tool_publication_operation WHERE publication_id='${pubs[0].id}'`)[0][0]);
  if (!process.env.CMD) for (const stream of ['stdout', 'stderr']) {
    try {
      const rb = L.rebuildStream(DB, pubs[0].id, stream);
      const exp = L.genStream(TAG, stream, stream === 'stdout' ? SO : SE);
      L.say(`bytes ${stream}`, `${rb.segments} seg ${rb.length} B ${rb.sha256 === exp ? 'EXACT' : 'differs from oracle (partial?)'}`);
    } catch (e) { L.say(`bytes ${stream}`, String(e)); }
  }
}
L.say('status', JSON.stringify(await s.status().catch((e: any) => String(e))));
L.say('harness', h.log().split('\n').filter((l: string) => /fail|block|error|retr|publication/i.test(l)).map((l: string) => l.slice(0, 260)).slice(0, 8));
fs.writeFileSync(`${L.RIG}/out/s654-${TAG}.json`, JSON.stringify({ sessionId, ws, pubs, tag: TAG, ledger: pub }, null, 1));
await h.stop();
await proxy.close();
process.exit(0);
