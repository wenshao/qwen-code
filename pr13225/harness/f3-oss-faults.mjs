// F3 (PR #13225): OSS SDK retry behaviour through the real adapter, base vs PR arm.
//   GET faults on the 3rd object of a public download: how many GETs reach OSS for that key, and does the
//   download finish with the right digest?  PUT 500 on one object of a new Shell publication: how many PUTs?
import * as L from './lib.mjs';
const ARM = process.env.ARM;
const TAG = process.env.TAG ?? `f3-${ARM}-${Date.now().toString(36)}`;
const SO = 6 * 1024 * 1024 + 7;
L.openLog(TAG);
const ws = `ws-${TAG}`; L.register(ws, process.env.ST ?? 'st-s07');
const S = await L.createShellSession(ws, L.shellPrompt('f3', L.genCmd(TAG, SO, 0, 0)), { key: `k-${TAG}` });
await L.waitTurn(S, { timeoutMs: 900_000 }); await L.waitProjection(S, { timeoutMs: 600_000 });
const a = (await L.artifacts(S)).list.find((x) => x.stream_role === 'stdout');
const pub = L.one(`SELECT publication_id FROM qwen_tool_publication WHERE session_id='${S}'`);
const want = L.genSha(TAG, 'stdout', SO);
const CASES = [
  ['500 InternalError x1', { mode: 'status', status: 500, code: 'InternalError', count: 1 }],
  ['503 ServiceUnavailable x1', { mode: 'status', status: 503, code: 'ServiceUnavailable', count: 1 }],
  ['500 UnknownError x1', { mode: 'status', status: 500, code: 'UnknownError', count: 1 }],
  ['502 non-XML body x1', { mode: 'html', status: 502, count: 1 }],
  ['reset before response x1', { mode: 'reset', count: 1 }],
  ['500 InternalError x6', { mode: 'status', status: 500, code: 'InternalError', count: 6 }],
  ['403 AccessDenied x1', { mode: 'status', status: 403, code: 'AccessDenied', count: 1 }],
];
const rows = [];
for (const [name, f] of CASES) {
  await L.oss('/clear-faults', {});
  await L.oss('/fault', { op: 'get', match: pub, skip: 2, ...f });
  const t = Date.now();
  const r = await L.streamDownload(S, a);
  await L.sleep(300);
  const gets = (await L.ossLedger()).filter((e) => e.t >= t && e.method === 'GET' && e.key.includes(pub));
  const per = new Map(); for (const g of gets) per.set(g.key, [...(per.get(g.key) ?? []), g.status]);
  const faulted = [...per.values()].find((v) => v.some((s) => String(s).includes('injected') || String(s).startsWith('reset'))) ?? [];
  const row = { case: name, http: r.status, ended: r.ended, shaOk: r.sha256 === want, bytes: r.bytes, faultedKeyGets: faulted.length, faultedKeyStatuses: faulted.join(','), ms: Date.now() - t };
  rows.push(row); L.say('get', row);
}
await L.oss('/clear-faults', {});
// PUT 500 on the 2nd object PUT of a new publication (the Java server performs these PUTs)
await L.oss('/fault', { op: 'put', mode: 'status', status: 500, code: 'InternalError', count: 1, skip: 1, match: 'managed-tool-results/' });
const t = Date.now();
const ws2 = `${ws}-put`; L.register(ws2, process.env.ST2 ?? 'st-s08');
const S2 = await L.createShellSession(ws2, L.shellPrompt('f3p', L.genCmd(`${TAG}-p`, SO, 0, 0)), { key: `k2-${TAG}` });
const turn2 = await L.waitTurn(S2, { timeoutMs: 600_000 }); const proj2 = await L.waitProjection(S2, { timeoutMs: 300_000 });
await L.oss('/clear-faults', {});
const puts = (await L.ossLedger()).filter((e) => e.t >= t && e.method === 'PUT');
const per = new Map(); for (const p of puts) per.set(p.key, [...(per.get(p.key) ?? []), p.status]);
const faulted = [...per.entries()].find(([, v]) => v.some((s) => String(s).includes('injected')));
const pub2 = L.sql(`SELECT state, producer_phase FROM qwen_tool_publication WHERE session_id='${S2}'`)[0];
L.say('put', { arm: ARM, turn: turn2.status, results: proj2.rows.map((r) => `${r.state}${r.failure ? '/' + r.failure : ''}`), faultedKeyPuts: faulted?.[1].length, statuses: faulted?.[1].join(','), putAttempts: L.putAttempts(L.one(`SELECT publication_id FROM qwen_tool_publication WHERE session_id='${S2}'`)), publication: pub2 });
L.out(`${TAG}.json`, { ARM, rows });
