// Seed a many-turn session through the real daemon API.
const BASE = 'http://127.0.0.1:4234';
const N = Number(process.argv[2] || 300);
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const created = await j(await fetch(BASE + '/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd: '/root/verify/pr12134/rig/ws', sessionScope: 'thread' }) }));
const sid = created.sessionId || created.id; const cid = created.clientId;
console.log('session', sid, cid);
const ctrl = new AbortController();
const ev = await fetch(`${BASE}/session/${sid}/events`, { headers: { 'x-qwen-client-id': cid, accept: 'text/event-stream' }, signal: ctrl.signal });
const reader = ev.body.getReader();
const dec = new TextDecoder();
let buf = '';
const done = new Map();
(async () => {
  for (;;) {
    const { value, done: d } = await reader.read().catch(() => ({ done: true }));
    if (d) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('');
      if (!data) continue;
      try {
        const e = JSON.parse(data);
        const type = e.type || e.event || (e.data && e.data.type);
        const pid = e.promptId || (e.data && e.data.promptId);
        if (/turn_complete|turn_error/.test(JSON.stringify(type)) && pid) done.set(pid, type);
      } catch {}
    }
  }
})();
const t0 = Date.now();
for (let k = 1; k <= N; k++) {
  const r = await j(await fetch(`${BASE}/session/${sid}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-qwen-client-id': cid }, body: JSON.stringify({ prompt: [{ type: 'text', text: `turn ${k}: short question number ${k}` }] }) }));
  if (!r.promptId) { console.log('prompt failed', k, r); process.exit(1); }
  const s = Date.now();
  while (!done.has(r.promptId)) { if (Date.now() - s > 30000) { console.log('timeout', k); process.exit(1); } await new Promise((x) => setTimeout(x, 5)); }
  if (k % 50 === 0) console.log('turns', k, 'in', Date.now() - t0, 'ms');
}
ctrl.abort();
console.log('SEEDED', sid);
process.exit(0);
