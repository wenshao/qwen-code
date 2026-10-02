// S4 (PR #13225): two live Spring instances (each with gc-enabled) share one database.
// Three Sessions are deleted together; owners are sampled while rows are DELETING. Each key must be
// deleted once, each publication released once, and both owners may take part.
import * as L from './lib.mjs';
const TAG = process.env.TAG ?? `s4-${Date.now().toString(36)}`, SO = Number(process.env.SO ?? 30 * 1024 * 1024 + 3);
L.openLog(TAG);
async function lifecycle(s, kind, method, url) { const r = await L.api(method, url, undefined, { key: `${kind}-${TAG}-${s.slice(0, 8)}` }); let op; for (let i = 0; i < 240 && r.status < 300; i++) { op = (await L.api('GET', `/v1/agents/sessions/${s}/operations/${r.json?.id}`)).json; if (/completed|failed/.test(String(op?.status))) break; await L.sleep(250); } return `${r.status} ${op?.status ?? r.json?.error?.code}`; }
const sessions = [];
for (const [i, st] of [['1', 'st-s32'], ['2', 'st-s33'], ['3', 'st-s34']]) {
  const ws = `ws-${TAG}-${i}`; L.register(ws, st);
  const s = await L.createShellSession(ws, L.shellPrompt(`s4${i}`, L.genCmd(`${TAG}-${i}`, SO, 0, 0)), { key: `k-${TAG}-${i}` });
  await L.waitTurn(s, { timeoutMs: 600_000 }); await L.waitProjection(s, { timeoutMs: 300_000 });
  await lifecycle(s, 'close', 'POST', `/v1/agents/sessions/${s}/close`);
  sessions.push(s);
}
const list = sessions.map((s) => `'${s}'`).join(',');
const pubs = L.sql(`SELECT publication_id, capture_held_bytes+producer_held_bytes+admission_held_bytes FROM qwen_tool_publication WHERE session_id IN (${list})`);
const keys = new Map(pubs.map(([p]) => [p, L.sql(`SELECT object_key FROM qwen_tool_publication_object WHERE publication_id='${p}' AND object_key IS NOT NULL`).map((r) => r[0])]));
const ledger0 = Date.now();
for (const s of sessions) L.say('delete', `${s.slice(0, 8)} ${await lifecycle(s, 'delete', 'DELETE', `/v1/agents/sessions/${s}`)}`);
const owners = new Map(pubs.map(([p]) => [p, new Set()]));
const t0 = Date.now();
for (;;) {
  const rows = L.sql(`SELECT publication_id, retention_state, IFNULL(gc_owner,'-'), gc_generation FROM qwen_tool_publication WHERE session_id IN (${list})`);
  for (const [p, st, o] of rows) if (st === 'DELETING' && o !== '-') owners.get(p).add(o.slice(0, 8));
  if (rows.every((r) => r[1] === 'COLLECTED') || Date.now() - t0 > 120_000) break;
  await L.sleep(50);
}
const dels = (await L.ossLedger()).filter((e) => e.t >= ledger0 && e.method === 'DELETE');
const per = new Map(); for (const d of dels) per.set(d.key, (per.get(d.key) ?? 0) + 1);
for (const [p, held] of pubs) {
  const r = L.sql(`SELECT retention_state, gc_generation, released_held_bytes FROM qwen_tool_publication WHERE publication_id='${p}'`)[0];
  const k = keys.get(p);
  L.say('pub', { pub: p.slice(0, 8), state: r[0], gen: +r[1], heldBefore: +held, released: +r[2], keys: k.length, deletedOnce: k.every((x) => per.get(x) === 1), maxPerKey: Math.max(...k.map((x) => per.get(x) ?? 0)), ownersSeen: [...owners.get(p)] });
}
const allOwners = new Set([...owners.values()].flatMap((s) => [...s]));
L.say('summary', { deleteRequests: dels.length, distinctKeys: per.size, totalKeys: [...keys.values()].flat().length, distinctOwnersAcrossPubs: [...allOwners], ms: Date.now() - t0 });
