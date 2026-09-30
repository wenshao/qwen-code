// VERIFICATION RIG ONLY: a client that only listens to the Session event streams learns about the approval
// (action.updated) on both surfaces, and can answer without polling the list. Needs `default` mode.
// usage: DB=<db> node s6-sse.mjs <workspace> <storage>
import { api, ensureWorkspace, createSession, getAction, respond, waitOp, waitTurn, readWs, Report, sleep, j, BASE, TENANT } from './lib.mjs';
const [workspace = 'ws-a', storage = 'a'] = process.argv.slice(2);
const R = new Report('s6-sse');
ensureWorkspace(workspace, `st-${storage}`);
const f = `sse-${Date.now().toString(36)}.txt`;
const c = await createSession('public', workspace, `D6_WRITE name=${f} content=via-sse`);
const S = c.session;
const headers = { 'X-Qwen-Tenant-Id': TENANT, 'X-Rig-Actor': 'alice', Accept: 'text/event-stream' };
function listen(name, url, init) {
  const events = [];
  const ac = new AbortController();
  const done = (async () => {
    const res = await fetch(url, { ...init, signal: ac.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = { t: Date.now() };
        for (const line of block.split('\n')) {
          const m = line.match(/^(event|data|id):\s?(.*)$/);
          if (m) ev[m[1]] = m[2];
        }
        if (ev.data) { try { ev.json = JSON.parse(ev.data); } catch {} }
        events.push(ev);
      }
    }
  })().catch(() => {});
  return { name, events, stop: () => ac.abort(), done };
}
const pub = listen('public', `${BASE}/v1/agents/sessions/${S}/events?stream=true`, { headers });
const web = listen('web', `${BASE}/api/agent/web-shell/v1/events/stream`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: S }) });
const find = (l, state) => l.events.find((e) => JSON.stringify(e.json ?? e.data ?? '').includes('action.updated') === true || e.event === 'action.updated' ? JSON.stringify(e.json ?? '').includes(`"state":"${state}"`) : false);
async function until(l, state, ms = 30_000) {
  const start = Date.now();
  for (;;) {
    const e = find(l, state);
    if (e) return e;
    if (Date.now() - start > ms) return null;
    await sleep(50);
  }
}
const rp = await until(pub, 'requested');
const rw = await until(web, 'requested');
R.check('public SSE delivers action.updated (requested)', !!rp, rp ? `event=${rp.event} data=${rp.data?.slice(0, 260)}` : j(pub.events.map((e) => e.event)));
R.check('WebShell SSE delivers action.updated (requested)', !!rw, rw ? `event=${rw.event} data=${rw.data?.slice(0, 260)}` : j(web.events.map((e) => e.event)));
const id = JSON.stringify(rp?.json ?? '').match(/tool_approval_[0-9a-f]{32}/)?.[0];
const detail = await getAction('public', S, id);
R.check('the streamed id opens the Action detail (no list call needed)', detail.status === 200 && detail.json.state === 'requested', `HTTP ${detail.status} ${detail.json.tool_name}`);
const t1 = Date.now();
const r = await respond('public', S, detail.json, 'allow', { key: 'sse-1' });
const dp = await until(pub, 'decided');
const dw = await until(web, 'decided');
R.check('both streams deliver action.updated (decided) after the answer', !!dp && !!dw, `public +${dp ? dp.t - t1 : '?'} ms, web +${dw ? dw.t - t1 : '?'} ms`);
const t = await waitTurn(S);
await sleep(500);
const term = (l) => l.events.map((e) => e.event ?? e.json?.type).filter(Boolean);
R.check('Turn completes and both streams carry the terminal event', t.status === 'COMPLETED' && readWs(storage, `child/${f}`) === 'via-sse', `public events=${j([...new Set(term(pub))])} web events=${j([...new Set(term(web))])}`);
pub.stop(); web.stop();
R.done();
process.exit(0);
