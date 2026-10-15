// Usage: node turn.mjs create <marker>            -> creates a Session with one text input
//        node turn.mjs send <sessionId> <marker>  -> posts a follow-up input message
//        node turn.mjs read <sessionId>           -> reads the Session and its full event history
import { writeFileSync } from 'node:fs';
const base = 'http://127.0.0.1:8080';
const tenant = 'reference-tenant';
const headers = { 'x-qwen-tenant-id': tenant };
const [mode, a, b] = process.argv.slice(2);
async function call(method, path, body) {
  const r = await fetch(base + path, { method, headers: { ...headers, ...(body ? { 'content-type': 'application/json', 'idempotency-key': `ref-${Date.now()}-${Math.random()}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}
async function waitTerminal(id, after) {
  let cursor = after; const events = [];
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const page = await call('GET', `/v1/agents/sessions/${id}/events?after=${cursor}&limit=100`);
    if (page.status !== 200) { console.log('EVENTS', page.status, JSON.stringify(page.body).slice(0, 400)); return { events, cursor }; }
    for (const e of page.body.data) { events.push(e); cursor = Math.max(cursor, e.sequence); }
    if (page.body.data.some((e) => e.terminal)) return { events, cursor };
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log('TIMEOUT'); return { events, cursor };
}
function summarize(events) {
  return events.map((e) => {
    const s = JSON.stringify(e);
    const txt = (s.match(/REFERENCE_TURN_[A-Z_]+/g) ?? []).filter((v, i, x) => x.indexOf(v) === i).join(',');
    return `${e.sequence} ${e.type}${e.terminal ? ' [terminal]' : ''}${txt ? ' ' + txt : ''}${e.error || e.data?.error ? ' ERR=' + JSON.stringify(e.error ?? e.data?.error).slice(0, 200) : ''}`;
  }).join('\n');
}
if (mode === 'create') {
  const t0 = Date.now();
  const r = await call('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'text', text: `${a}. Reply exactly with the configured answer.` }], metadata: { title: 'Reference distribution walk-through' } });
  console.log('CREATE', r.status, JSON.stringify(r.body).slice(0, 300));
  if (r.status !== 202) process.exit(1);
  const { events } = await waitTerminal(r.body.id, 0);
  console.log(summarize(events)); console.log(`SESSION ${r.body.id} elapsed=${Date.now() - t0}ms`);
  writeFileSync(`${process.env.OPDIR ?? '/rig/op'}/logs/session-${a}.json`, JSON.stringify({ create: r, events }, null, 2));
} else if (mode === 'send') {
  const before = await call('GET', `/v1/agents/sessions/${a}/events?after=0&limit=100`);
  const after = Math.max(0, ...before.body.data.map((e) => e.sequence));
  const t0 = Date.now();
  const r = await call('POST', `/v1/agents/sessions/${a}/events`, { type: 'agent.session.input.message', input: [{ type: 'text', text: `${b}. Use the prior conversation and reply with the configured answer.` }] });
  console.log('SEND', r.status, JSON.stringify(r.body).slice(0, 300));
  if (r.status !== 202) process.exit(1);
  const { events } = await waitTerminal(a, after);
  console.log(summarize(events)); console.log(`elapsed=${Date.now() - t0}ms`);
  writeFileSync(`${process.env.OPDIR ?? '/rig/op'}/logs/session-${b}.json`, JSON.stringify({ send: r, events }, null, 2));
} else if (mode === 'read') {
  const s = await call('GET', `/v1/agents/sessions/${a}`);
  console.log('SESSION', s.status, JSON.stringify(s.body).slice(0, 400));
  const ev = await call('GET', `/v1/agents/sessions/${a}/events?after=0&limit=100`);
  console.log('HISTORY', ev.status, `${ev.body.data?.length} events`); console.log(summarize(ev.body.data ?? []));
}
