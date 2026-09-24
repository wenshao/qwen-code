// Scenario B: wire frames for an approved (default-mode) shell call, per arm.
import fs from 'node:fs';
const [port, arm, scn = 'approve', vote = 'proceed_once'] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`; const H = { authorization: 'Bearer tok12466', 'content-type': 'application/json' };
const ws = `/private/var/tmp/pr12466/${arm}/ws`;
const j = async (method, path, body) => { const r = await fetch(base + path, { method, headers: H, body: body && JSON.stringify(body) }); const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; } };
const s = await j('POST', '/session', { cwd: ws, sessionScope: 'thread' });
const id = s.body.sessionId ?? s.body.id; if (!id) { console.log(s); process.exit(1); }
console.error('session', id, (await j('POST', `/session/${id}/approval-mode`, { mode: 'default' })).status);
const frames = []; let done = false;
const ac = new AbortController();
(async () => {
  const r = await fetch(`${base}/session/${id}/events`, { headers: H, signal: ac.signal });
  const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) { const { value, done: d } = await rd.read(); if (d) break; buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (!data) continue; try { const ev = JSON.parse(data); frames.push({ t: Date.now(), ev }); await onEvent(ev); } catch {} } }
})().catch(() => {});
async function onEvent(ev) {
  if (ev.type === 'permission_request') {
    const rid = ev.data?.requestId; await new Promise((r) => setTimeout(r, 1500));
    const v = await j('POST', `/session/${id}/permission/${rid}`, { outcome: vote === 'cancel' ? { outcome: 'cancelled' } : { outcome: 'selected', optionId: vote } });
    console.error('voted', vote, v.status, JSON.stringify(v.body).slice(0, 200));
  }
}
await new Promise((r) => setTimeout(r, 800));
const p = await j('POST', `/session/${id}/prompt`, { prompt: [{ type: 'text', text: `SCN:${scn} wire-${arm}` }] });
console.error('prompt', p.status);
for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 500)); const st = await j('GET', `/session/${id}/status`); if (i > 4 && st.body?.hasActivePrompt === false) break; }
ac.abort();
const tool = frames.filter(({ ev }) => ['session_update', 'permission_request', 'permission_resolved'].includes(ev.type) && (ev.type !== 'session_update' || /tool_call/.test(ev.data?.update?.sessionUpdate)));
const t0 = tool[0]?.t ?? 0;
const summary = tool.map(({ t, ev }) => ev.type === 'session_update'
  ? `${t - t0}ms ${ev.data.update.sessionUpdate} status=${ev.data.update.status ?? '-'} kind=${ev.data.update.kind ?? '-'} title=${ev.data.update.title ? JSON.stringify(ev.data.update.title).slice(0, 40) : '-'} meta=${Object.keys(ev.data.update._meta ?? {}).join(',')}${ev.data.update._meta?.startedAt ? ' startedAt=' + ev.data.update._meta.startedAt : ''}`
  : `${t - t0}ms ${ev.type} ${(ev.data?.toolCall?.toolCallId ?? '') + ' ' + (ev.data?.outcome ? JSON.stringify(ev.data.outcome) : '')}`);
console.log(`# arm=${arm} scn=${scn} vote=${vote} session=${id}`); console.log(summary.join('\n'));
fs.writeFileSync(`/private/var/tmp/pr12466/wire-${arm}-${scn}-${vote}.json`, JSON.stringify({ id, frames }, null, 1));
