// Seed one real session through a real daemon: N prompts, each awaited on SSE.
// usage: node seed.mjs <daemonUrl> <token> <cwd> <turns> [sessionId]
const [base, token, cwd, turnsArg, existing] = process.argv.slice(2);
const turns = Number(turnsArg);
const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
async function j(method, path, body, extra = {}) {
  const r = await fetch(base + path, { method, headers: { ...auth, ...extra }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : {};
}
let sessionId, clientId;
if (existing) {
  const s = await j('POST', `/session/${existing}/load`, { cwd });
  sessionId = existing; clientId = s.clientId;
} else {
  const s = await j('POST', '/session', { cwd, sessionScope: 'thread' });
  sessionId = s.sessionId; clientId = s.clientId;
}
console.log('SESSION', sessionId, clientId);
const ctl = new AbortController();
const events = await fetch(`${base}/session/${sessionId}/events`, { headers: { ...auth, 'x-qwen-client-id': clientId, accept: 'text/event-stream' }, signal: ctl.signal });
const reader = events.body.getReader(); const dec = new TextDecoder();
const waiters = new Map(); let buf = '';
(async () => {
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
      if (!data) continue; let ev; try { ev = JSON.parse(data); } catch { continue; }
      if (ev.type === 'turn_complete' || ev.type === 'turn_error') { const pid = ev.data?.promptId; const w = waiters.get(pid); if (w) { waiters.delete(pid); w(ev); } else { pending.push(ev); } }
    } } } catch {}
})();
const pending = [];
const t0 = Date.now(); const start = Number(process.env.START ?? 1);
for (let k = start; k < start + turns; k++) {
  const r = await j('POST', `/session/${sessionId}/prompt`, { prompt: [{ type: 'text', text: (process.env.LONG_AT && Number(process.env.LONG_AT) === k) ? `Long #${k}: read every note, one at a time.` : `Prompt #${k}: read the note and summarise it.` }] }, { 'x-qwen-client-id': clientId });
  const ev = await new Promise((resolve) => { const early = pending.findIndex(e => e.data?.promptId === r.promptId); if (early >= 0) { resolve(pending.splice(early, 1)[0]); return; } waiters.set(r.promptId, resolve); });
  if (ev.type !== 'turn_complete') { console.log('TURN_ERROR', k, JSON.stringify(ev).slice(0, 400)); }
  if (k % 25 === 0) console.log('turn', k, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
ctl.abort();
console.log('DONE', sessionId, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(0);
