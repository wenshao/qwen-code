// Probe: send one user Turn and record when its terminal event appears on
// /events versus when its assistant output appears on /items.
// usage: node probe-m.mjs <db> <sid> <label>
import { readFileSync, appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const [, , db, sid, label] = process.argv;
const RIG = '/Users/wenshao/git/pr13598-rig';
const st = JSON.parse(readFileSync(`${RIG}/runs/${db}/state.json`, 'utf8'));
const base = `http://127.0.0.1:${st.springPort}/v1/agents/sessions/${sid}`;
const H = { 'x-qwen-tenant-id': 'rig', 'x-rig-actor': 'rig-actor', 'content-type': 'application/json' };
const t0 = Date.now();
const iso = (t) => new Date(t).toISOString().slice(11, 23);
const marker = `MPROBE${Date.now()}`;
const r = await fetch(`${base}/events`, {
  method: 'POST',
  headers: { ...H, 'idempotency-key': randomUUID() },
  body: JSON.stringify({ type: 'agent.session.input.message', input: [{ type: 'input_text', text: `USER::m ${label} ${marker} Reply with exactly: OK` }] }),
});
const sent = await r.json();
const turnId = sent.turn_id;
let completedAt = null;
let itemAt = null;
const deadline = t0 + 120_000;
while (Date.now() < deadline && (completedAt === null || itemAt === null)) {
  if (completedAt === null) {
    const ev = await (await fetch(`${base}/events?after=0&limit=500`, { headers: H })).json();
    if ((ev.data ?? []).some((e) => e.turn_id === turnId && e.terminal)) completedAt = Date.now();
  }
  if (itemAt === null) {
    const it = await (await fetch(`${base}/items?limit=100`, { headers: H })).json();
    if ((it.data ?? []).some((i) => i.id === `item_${turnId}_assistant` && JSON.stringify(i.content ?? []).includes('output_text'))) itemAt = Date.now();
  }
  await new Promise((res) => setTimeout(res, 200));
}
const line = { label, turnId, sent: iso(t0), completedEvent: completedAt && iso(completedAt), itemVisible: itemAt && iso(itemAt), itemLagAfterTerminalMs: completedAt && itemAt ? itemAt - completedAt : null };
console.log(JSON.stringify(line));
appendFileSync(`${RIG}/runs/${db}/probe-m.jsonl`, JSON.stringify(line) + '\n');
