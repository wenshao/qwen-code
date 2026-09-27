// End-to-end Session query flow against real Spring + MySQL + hosted harness
// + scripted model: both surfaces, both input spellings, parity, watermarks.
//   node probe-flow.mjs <baseUrl> <arm> <out.json>
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const [base, arm, out] = process.argv.slice(2);
const T = `rig-${arm}-flow-${randomUUID().slice(0, 6)}`;
const OTHER = `${T}-other`;
const WS = '/api/agent/web-shell/v1';
const PUB = '/v1/agents/sessions';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const result = { arm, tenant: T, steps: [] };

async function call(method, path, { tenant = T, body, headers = {} } = {}) {
  const h = { 'X-Qwen-Tenant-Id': tenant, accept: 'application/json', ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, xrid: res.headers.get('x-request-id'), replay: res.headers.get('idempotent-replay') };
}
function step(name, value) {
  result.steps.push({ name, value });
  console.log(`${name}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
}
async function settle(sessionId, tenant = T) {
  for (let i = 0; i < 120; i++) {
    const r = await call('POST', `${WS}/sessions/get`, { tenant, body: { sessionId } });
    if (r.json && (!r.json.activeTurn || ['completed', 'failed', 'cancelled'].includes(r.json.activeTurn.status))) return r.json;
    await sleep(250);
  }
  throw new Error('turn did not settle');
}

// 1. WebShell create with the contract spelling.
const k1 = `k-${randomUUID()}`;
const c1 = await call('POST', `${WS}/sessions/create`, { body: { requestId: `rq-${arm}-create`, idempotencyKey: k1, agentId: 'rig-agent', title: 'D2 rig', input: [{ type: 'input_text', text: 'hello via input_text' }] } });
step('1 WebShell create input_text', { status: c1.status, code: c1.json?.error?.code ?? null, xrid: c1.xrid, body: c1.json });
if (c1.status !== 202) {
  fs.writeFileSync(out, JSON.stringify(result, null, 1));
  process.exit(0);
}
const sid = c1.json.sessionId;
const turn1 = c1.json.turnId;
// Public view while the Turn is still active.
const early = await call('GET', `${PUB}/${sid}`);
step('2 public get while active', { status: early.status, active_turn: early.json?.active_turn ?? null });
const wsDone = await settle(sid);
// 2. Legacy spelling on the same Session.
const k2 = `k-${randomUUID()}`;
const s2 = await call('POST', `${WS}/turns/submit`, { body: { requestId: `rq-${arm}-submit`, idempotencyKey: k2, sessionId: sid, input: [{ type: 'text', text: 'second via legacy text' }] } });
step('3 WebShell submit legacy text', { status: s2.status, xrid: s2.xrid, body: s2.json });
await settle(sid);
// 3. Replay the same key with the other spelling: must be an idempotent replay.
const s2r = await call('POST', `${WS}/turns/submit`, { body: { requestId: `rq-${arm}-replay`, idempotencyKey: k2, sessionId: sid, input: [{ type: 'input_text', text: 'second via legacy text' }] } });
step('4 replay same key, input_text spelling', { status: s2r.status, code: s2r.json?.error?.code ?? null, replayed: s2r.json?.replayed, turnId: s2r.json?.turnId, sameTurn: s2r.json?.turnId === s2.json?.turnId });
// Let the materializer catch up.
await sleep(3000);
const wsGet = await call('POST', `${WS}/sessions/get`, { body: { sessionId: sid } });
const pubGet = await call('GET', `${PUB}/${sid}`);
const pubList = await call('GET', `${PUB}?limit=100`);
const wsList = await call('POST', `${WS}/sessions/query`, { body: { limit: 100 } });
const items = await call('GET', `${PUB}/${sid}/items?limit=100`);
const listed = pubList.json?.data?.find((s) => s.id === sid);
const wsListed = (wsList.json?.data ?? []).find((s) => s.sessionId === sid);
step('5 public get', pubGet.json);
step('6 webshell get', wsGet.json);
const parity = {
  id: [pubGet.json.id, listed?.id, wsGet.json.sessionId, wsListed?.sessionId],
  agent: [pubGet.json.agent_id, listed?.agent_id, wsGet.json.agentId, wsListed?.agentId],
  status: [pubGet.json.status, listed?.status, wsGet.json.status, wsListed?.status],
  lastSequence: [pubGet.json.last_event_id, listed?.last_event_id, wsGet.json.lastSequence, wsListed?.lastSequence],
};
parity.allEqual = Object.values(parity).every((v) => Array.isArray(v) ? new Set(v.map(String)).size === 1 : true);
step('7 parity [public get, public list, WS get, WS query]', parity);
const itemIds = (items.json?.data ?? []).map((i) => i.id);
step('8 items', {
  status: items.status,
  snapshot_through_sequence: items.json?.snapshot_through_sequence,
  session_snapshot_through_sequence: pubGet.json.snapshot_through_sequence,
  watermarkEqual: items.json?.snapshot_through_sequence === pubGet.json.snapshot_through_sequence,
  itemIds,
  inputItemOfTurn1Present: itemIds.includes(`item_${turn1}_input`),
});
// 4. Cross-tenant reads on both surfaces.
const x1 = await call('GET', `${PUB}/${sid}`, { tenant: OTHER });
const x2 = await call('POST', `${WS}/sessions/get`, { tenant: OTHER, body: { sessionId: sid } });
const x3 = await call('GET', `${PUB}/${sid}/items`, { tenant: OTHER });
step('9 cross-tenant', { publicGet: `${x1.status} ${x1.json?.error?.code}`, webShellGet: `${x2.status} ${x2.json?.error?.code}`, items: `${x3.status} ${x3.json?.error?.code}` });
// 5. Archive: status comes back as "archived" (now in the contract enum).
const ar = await call('POST', `${PUB}/${sid}/archive`, { headers: { 'Idempotency-Key': `k-${randomUUID()}` } });
const afterArchive = await call('GET', `${PUB}/${sid}`);
const wsAfterArchive = await call('POST', `${WS}/sessions/get`, { body: { sessionId: sid } });
step('10 archive', { archiveStatus: ar.status, publicStatus: afterArchive.json?.status, webShellStatus: wsAfterArchive.json?.status });
// 6. Public create with input_text.
const pc = await call('POST', PUB, { body: { agent_id: 'rig-agent', input: [{ type: 'input_text', text: 'public create via input_text' }] }, headers: { 'Idempotency-Key': `k-${randomUUID()}` } });
step('11 public create input_text', { status: pc.status, code: pc.json?.error?.code ?? null, agent_revision: pc.json?.agent_revision, active_turn: pc.json?.active_turn ?? null });
fs.writeFileSync(out, JSON.stringify(result, null, 1));
