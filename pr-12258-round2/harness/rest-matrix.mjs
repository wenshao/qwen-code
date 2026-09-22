// REST-level matrix against POST /session/:id/mcp-app/tools/call on a live daemon.
// usage: node rest-matrix.mjs <daemonPort> <token> <workspace> <out.json>
import fs from 'node:fs';
const [DP, TOKEN, WS, OUT] = process.argv.slice(2);
const base = `http://127.0.0.1:${DP}`;
const H = (cid) => ({ 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(cid ? { 'x-qwen-client-id': cid } : {}) });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const rec = (name, o) => { results.push({ name, ...o }); console.log(name, JSON.stringify(o).slice(0, 300)); fs.writeFileSync(OUT, JSON.stringify(results, null, 1)); };
async function j(method, path, body, cid, signal) {
  const r = await fetch(base + path, { method, headers: H(cid), body: body === undefined ? undefined : JSON.stringify(body), signal });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}
async function newSession() { const r = await j('POST', '/session', { cwd: WS, sessionScope: 'thread' }); return { id: r.body.sessionId, cid: r.body.clientId, raw: r }; }
function sse(sessionId, cid, sink) {
  const ctl = new AbortController();
  (async () => {
    const r = await fetch(`${base}/session/${sessionId}/events`, { headers: { ...H(cid), accept: 'text/event-stream' }, signal: ctl.signal });
    const dec = new TextDecoder(); let buf = '';
    for await (const chunk of r.body) { buf += dec.decode(chunk, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const frame = buf.slice(0, i); buf = buf.slice(i + 2); const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n'); const ev = frame.split('\n').find(l => l.startsWith('event:'))?.slice(6).trim(); if (data) { try { sink.push({ ev, ...JSON.parse(data), _t: Date.now() }); } catch {} } } }
  })().catch(() => {});
  return ctl;
}
const waitFor = async (pred, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = pred(); if (v) return v; await sleep(100); } return null; };
const call = (sid, cid, body, signal) => j('POST', `/session/${sid}/mcp-app/tools/call`, body, cid, signal).catch(e => ({ status: 'THROW', body: String(e.name) }));
const good = { serverName: 'fixture', resourceUri: 'ui://fixture/dashboard', name: 'get_embed_token', arguments: {} };

const S1 = await newSession(); const S2 = await newSession();
rec('sessions', { S1: S1.id, S2: S2.id, distinct: S1.id !== S2.id, raw1: S1.raw.status });
const ev1 = []; const sse1 = sse(S1.id, S1.cid, ev1);
await j('POST', `/session/${S1.id}/prompt`, { prompt: [{ type: 'text', text: 'hello' }] }, S1.cid);
await waitFor(() => ev1.find(e => /turn_complete|turn_end|prompt_complete/.test(e.type ?? e.ev ?? '')), 30000);
await sleep(1500);
rec('A1 no client id', await call(S1.id, undefined, good));
rec('A2 unknown client id', await call(S1.id, 'client_00000000-0000-0000-0000-000000000000', good));
rec('A3 client of another session', await call(S1.id, S2.cid, good));
rec('A4 unknown session', await call('00000000-0000-0000-0000-000000000000', S1.cid, good));
rec('A5 resourceUri not ui://', await call(S1.id, S1.cid, { ...good, resourceUri: 'https://evil/x' }));
rec('A6 arguments is array', await call(S1.id, S1.cid, { ...good, arguments: [] }));
rec('A7 model-only tool', await call(S1.id, S1.cid, { ...good, name: 'model_only_tool' }));
rec('A8 foreign server + this App resource', await call(S1.id, S1.cid, { ...good, serverName: 'other' }));
rec('A9 unadvertised resource on right server', await call(S1.id, S1.cid, { ...good, resourceUri: 'ui://fixture/nope' }));
rec('A10 prefixed model name instead of raw', await call(S1.id, S1.cid, { ...good, name: 'mcp__fixture__get_embed_token' }));
rec('A11 null-visibility tool', await call(S1.id, S1.cid, { ...good, name: 'null_visibility_tool' }));
// B: concurrent model approval + App approval; disconnect the App call → only the App approval is cancelled
const permEvents = () => ev1.filter(e => /permission/.test(e.type ?? ''));
await j('POST', `/session/${S1.id}/prompt`, { prompt: [{ type: 'text', text: 'show dashboard' }] }, S1.cid);
const modelPerm = await waitFor(() => ev1.find(e => e.type === 'permission_request' && JSON.stringify(e).includes('show_dashboard')));
const ctl = new AbortController();
const appCallP = call(S1.id, S1.cid, good, ctl.signal);
const appPerm = await waitFor(() => ev1.find(e => e.type === 'permission_request' && JSON.stringify(e).includes('get_embed_token')));
await sleep(500); ctl.abort(); await appCallP;
await sleep(1500);
const summary = permEvents().map(e => ({ type: e.type, requestId: e.data?.requestId ?? e.requestId, tool: (JSON.stringify(e).match(/mcp__\w+__\w+/) || [])[0], outcome: e.data?.outcome ?? e.outcome }));
rec('B1 events after App disconnect', { modelPermSeen: !!modelPerm, appPermSeen: !!appPerm, summary });
const modelReqId = modelPerm?.data?.requestId ?? modelPerm?.requestId;
const vote = await j('POST', `/permission/${modelReqId}`, { outcome: { outcome: 'selected', optionId: 'proceed_once' } }, S1.cid);
const done = await waitFor(() => ev1.filter(e => JSON.stringify(e).includes('[done:dashboard]')).length > 0, 30000);
rec('B2 model approval still answerable after App disconnect', { vote: vote.status, modelTurnFinished: !!done });
const appReqId = appPerm?.data?.requestId ?? appPerm?.requestId;
rec('B3 vote on the cancelled App approval', await j('POST', `/permission/${appReqId}`, { outcome: { outcome: 'selected', optionId: 'proceed_once' } }, S1.cid));
fs.writeFileSync(OUT.replace('.json', '-events.json'), JSON.stringify(ev1, null, 1));
sse1.abort(); process.exit(0);
