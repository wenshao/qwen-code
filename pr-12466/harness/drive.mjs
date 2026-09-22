// Drive one real daemon session through scripted scenarios and record every SSE
// event. usage: node drive.mjs <base> <token> <cwd> <sessionId|new> <scn,scn,...> <outPrefix>
import fs from 'node:fs';
const [base, token, cwd, existing, scnArg, out] = process.argv.slice(2);
const scns = scnArg.split(',');
const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function j(method, path, body, extra = {}) {
  const r = await fetch(base + path, { method, headers: { ...auth, ...extra }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : {};
}
let sessionId, clientId;
if (existing !== 'new') { const s = await j('POST', `/session/${existing}/load`, { cwd }); sessionId = existing; clientId = s.clientId; }
else { const s = await j('POST', '/session', { cwd, sessionScope: 'thread' }); sessionId = s.sessionId; clientId = s.clientId; }
console.log('SESSION', sessionId);
const H = { 'x-qwen-client-id': clientId };
const evlog = fs.createWriteStream(`${out}.events.ndjson`, { flags: 'a' });
const ctl = new AbortController();
const events = await fetch(`${base}/session/${sessionId}/events`, { headers: { ...auth, ...H, accept: 'text/event-stream' }, signal: ctl.signal });
const reader = events.body.getReader(); const dec = new TextDecoder();
const listeners = new Set(); let buf = '';
(async () => {
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
      if (!data) continue; let ev; try { ev = JSON.parse(data); } catch { continue; }
      evlog.write(JSON.stringify({ t: Date.now(), ev }) + '\n');
      for (const l of listeners) l(ev);
    } } } catch {}
})();
const summary = [];
for (const scn of scns) {
  if (scn === 'approve') await j('POST', `/session/${sessionId}/approval-mode`, { mode: 'default' }, H);
  const r = await j('POST', `/session/${sessionId}/prompt`, { prompt: [{ type: 'text', text: `SCN:${scn} — run the ${scn} scenario` }] }, H);
  const t0 = Date.now();
  const done = new Promise((resolve) => {
    const l = async (ev) => {
      if (ev.type === 'permission_request' && scn === 'approve') {
        const reqId = ev.data?.requestId; await sleep(1500);
        const vote = await fetch(`${base}/session/${sessionId}/permission/${reqId}`, { method: 'POST', headers: { ...auth, ...H }, body: JSON.stringify({ outcome: { outcome: 'selected', optionId: 'proceed_once' } }) });
        console.log('VOTE', reqId, vote.status, 'after', Date.now() - t0, 'ms');
      }
      if (scn.startsWith('cancel') && ev.type === 'session_update' && (ev.data?.update?.toolCallId ?? ev.data?.toolCallId) === (scn === 'cancel2' ? 'cx2_shell' : 'cx_shell') && !l.cancelled) {
        l.cancelled = true; await sleep(1500);
        const c = await fetch(`${base}/session/${sessionId}/cancel`, { method: 'POST', headers: { ...auth, ...H }, body: '{}' });
        console.log('CANCEL', c.status, 'after', Date.now() - t0, 'ms');
      }
      if ((ev.type === 'turn_complete' || ev.type === 'turn_error') && ev.data?.promptId === r.promptId) { listeners.delete(l); resolve(ev); }
    };
    listeners.add(l);
  });
  const ev = await Promise.race([done, sleep(120000).then(() => ({ type: 'timeout' }))]);
  summary.push({ scn, promptId: r.promptId, result: ev.type, ms: Date.now() - t0, stopReason: ev.data?.stopReason });
  console.log('TURN', scn, ev.type, ev.data?.stopReason ?? '', `${Date.now() - t0}ms`);
  if (scn === 'approve') await j('POST', `/session/${sessionId}/approval-mode`, { mode: 'yolo' }, H);
  await sleep(300);
}
fs.writeFileSync(`${out}.summary.json`, JSON.stringify({ sessionId, clientId, summary }, null, 2));
ctl.abort(); evlog.end();
console.log('DONE', sessionId);
process.exit(0);
