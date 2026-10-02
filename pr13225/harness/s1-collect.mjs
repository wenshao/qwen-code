// S1 (PR #13225): public lifecycle end to end. Two Workspace Sessions in one Workspace each run one real
// Hosted Shell through the public Turn path. Session A: public close -> public DELETE (retires output);
// Session B stays open (sibling control). Then watch the collector until A's publication is COLLECTED.
// env: ARM, DB, SO (stdout bytes), SE (stderr bytes), WATCH_S, ST_A, ST_B
import * as L from './lib.mjs';
const ARM = process.env.ARM ?? 'merge34';
const SO = Number(process.env.SO ?? 12 * 1024 * 1024 + 4099), SE = Number(process.env.SE ?? 1024 * 1024 + 77);
const TAG = process.env.TAG ?? `s1-${ARM}-${Date.now().toString(36)}`;
L.openLog(TAG);
const ws = `ws-${TAG}`;

async function lifecycle(session, kind, method, url) {
  const key = `${kind}-${TAG}`;
  const t0 = Date.now();
  const r = await L.api(method, url, undefined, { key });
  const opId = r.json?.operation?.id ?? r.json?.id;
  let op = r.json;
  for (let i = 0; i < 480 && r.status < 300; i++) {
    const g = await L.api('GET', `/v1/agents/sessions/${session}/operations/${opId}`);
    op = g.json;
    if (/completed|failed/i.test(String(op?.status ?? ''))) break;
    await L.sleep(250);
  }
  return { http: r.status, code: r.json?.error?.code, op: op?.status, opId, ms: Date.now() - t0 };
}
const pub = (session) => L.sql(`SELECT publication_id, scope_key, retention_state, gc_generation, IFNULL(gc_owner,'-'), IFNULL(gc_blocker,'-'), gc_cursor, capture_held_bytes+producer_held_bytes+admission_held_bytes, capture_used_bytes+producer_used_bytes+admission_used_bytes, IFNULL(collected_bytes,'-'), IFNULL(released_held_bytes,'-'), IFNULL(collected_at,'-') FROM qwen_tool_publication WHERE session_id='${session}'`)
  .map((r) => ({ id: r[0], scope: r[1], state: r[2], gen: +r[3], owner: r[4], blocker: r[5], cursor: r[6], held: +r[7], used: +r[8], collected: r[9], released: r[10], collectedAt: r[11] }));
const objs = (session) => L.sql(`SELECT o.slot_key, IFNULL(o.object_key,'-'), o.state, o.inline_bytes IS NOT NULL, o.byte_length, IFNULL(o.resource_id,'-') FROM qwen_tool_publication_object o JOIN qwen_tool_publication p ON p.scope_key=o.scope_key AND p.publication_id=o.publication_id WHERE p.session_id='${session}' ORDER BY o.slot_key`)
  .map((r) => ({ slot: r[0], key: r[1] === '-' ? null : r[1], state: r[2], inline: r[3] === '1', bytes: +r[4], resource: r[5] }));
const resInline = (session) => +L.one(`SELECT COUNT(*) FROM qwen_managed_session_resource WHERE session_id='${session}' AND inline_bytes IS NOT NULL`);
const summary = (session) => {
  const o = objs(session);
  return { objects: o.length, oss: o.filter((x) => x.key).length, ossPresent: o.filter((x) => x.key && L.ossHas(x.key)).length, inline: o.filter((x) => x.inline).length, resourceInline: resInline(session), states: [...new Set(o.map((x) => x.state))].join('/') };
};

const t0 = Date.now();
L.register(ws, process.env.ST_A ?? 'st-s01');
const A = await L.createShellSession(ws, L.shellPrompt('s1a', L.genCmd(`${TAG}-a`, SO, SE, 0)));
L.register(`${ws}-b`, process.env.ST_B ?? 'st-s02');
const B = await L.createShellSession(`${ws}-b`, L.shellPrompt('s1b', L.genCmd(`${TAG}-b`, SO, SE, 0)), { key: `kb-${TAG}` });
const ta = await L.waitTurn(A, { timeoutMs: 900_000 }), tb = await L.waitTurn(B, { timeoutMs: 900_000 });
const pa = await L.waitProjection(A, { timeoutMs: 300_000 }), pb = await L.waitProjection(B, { timeoutMs: 300_000 });
L.say('turns', { A, B, turnA: ta.status, turnB: tb.status, projA: pa.rows.map((r) => r.state), projB: pb.rows.map((r) => r.state), ms: Date.now() - t0 });
const artsA = (await L.artifacts(A)).list, artsB = (await L.artifacts(B)).list;
const stdoutA = artsA.find((x) => x.stream_role === 'stdout'), stdoutB = artsB.find((x) => x.stream_role === 'stdout');
const wantA = L.genSha(`${TAG}-a`, 'stdout', SO), wantB = L.genSha(`${TAG}-b`, 'stdout', SO);
L.say('artifacts', { A: artsA.map((x) => `${x.stream_role}:${x.byte_length}`), B: artsB.map((x) => `${x.stream_role}:${x.byte_length}`) });
L.say('read-before', { A: await L.downloadCheck(A, stdoutA, wantA), B: await L.downloadCheck(B, stdoutB, wantB) });
L.say('catalog-before', { A: { pub: pub(A).map(({ scope, ...p }) => p), ...summary(A) }, B: { pub: pub(B).map(({ scope, ...p }) => p), ...summary(B) } });
const caps = (await L.api('GET', `/v1/agents/sessions/${A}`)).json?.capabilities;
L.say('capabilities-before-close', caps);

const ledger0 = Date.now();
const close = await lifecycle(A, 'close', 'POST', `/v1/agents/sessions/${A}/close`);
L.say('close', close);
const caps2 = (await L.api('GET', `/v1/agents/sessions/${A}`)).json?.capabilities;
L.say('capabilities-after-close', caps2);
const del = await lifecycle(A, 'delete', 'DELETE', `/v1/agents/sessions/${A}`);
L.say('delete', del);
const ret = L.retirement(A);
L.say('retired', { retirement: ret, pub: pub(A).map((p) => `${p.id.slice(0, 8)} ${p.state} blocker=${p.blocker}`), readAfterDelete: (await L.api('GET', `/v1/agents/sessions/${A}/artifacts`)).status });
const retiredAt = Number(ret?.[2] ?? 0);

// watch
const keysA = objs(A).filter((x) => x.key).map((x) => x.key);
const keysB = objs(B).filter((x) => x.key).map((x) => x.key);
let last = '';
const timeline = [];
const end = Date.now() + Number(process.env.WATCH_S ?? 120) * 1000;
for (;;) {
  const p = pub(A)[0];
  const present = keysA.filter((k) => L.ossHas(k)).length;
  const key = `${p.state} g${p.gen} ${p.blocker} cur=${p.cursor || '-'} held=${p.held} used=${p.used} oss=${present}`;
  if (key !== last) {
    const dbNow = Number(L.one('SELECT ROUND(UNIX_TIMESTAMP(NOW(3))*1000)'));
    const row = `+${((dbNow - retiredAt) / 1000).toFixed(1)}s after retirement: ${key}`;
    timeline.push(row); L.say('watch', row); last = key;
  }
  if (p.state === 'COLLECTED' || Date.now() > end) break;
  await L.sleep(100);
}
const ledger = (await L.ossLedger()).filter((e) => e.t >= ledger0);
const deletes = ledger.filter((e) => e.method === 'DELETE');
const perKey = new Map(); for (const d of deletes) perKey.set(d.key, (perKey.get(d.key) ?? 0) + 1);
const versioningProbes = ledger.filter((e) => e.method === 'GET' && e.query === '?versioning').length;
const listCalls = ledger.filter((e) => e.method === 'GET' && !e.key).length;
L.say('oss-ledger', {
  deletes: deletes.length, distinctKeys: perKey.size, maxPerKey: Math.max(0, ...perKey.values()),
  deletedOnlyAKeys: [...perKey.keys()].every((k) => keysA.includes(k)), allAKeysDeleted: keysA.every((k) => perKey.has(k)),
  bKeysTouched: [...perKey.keys()].filter((k) => keysB.includes(k)).length, versioningProbes, bucketListCalls: listCalls,
  statuses: [...new Set(deletes.map((d) => d.status))],
});
L.say('catalog-after', { A: { pub: pub(A).map(({ scope, ...p }) => p), ...summary(A) }, B: { pub: pub(B).map(({ scope, ...p }) => p), ...summary(B) } });
L.say('read-after', { B: await L.downloadCheck(B, stdoutB, wantB), A_session: (await L.api('GET', `/v1/agents/sessions/${A}`)).status });
L.out(`${TAG}.json`, { arm: ARM, A, B, close, del, ret, timeline });
