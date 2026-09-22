import fs from 'node:fs';
const [DP, TOKEN, WS, LOG, OUT] = process.argv.slice(2); const base = `http://127.0.0.1:${DP}`;
const H = (cid) => ({ 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(cid ? { 'x-qwen-client-id': cid } : {}) });
const j = async (m, p, b, cid) => { const r = await fetch(base + p, { method: m, headers: H(cid), body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let x; try { x = JSON.parse(t); } catch { x = t; } return { status: r.status, body: x }; };
const s = await j('POST', '/session', { cwd: WS, sessionScope: 'thread' }); const sid = s.body.sessionId, cid = s.body.clientId;
const ev = []; const ctl = new AbortController();
(async () => { const r = await fetch(`${base}/session/${sid}/events`, { headers: { ...H(cid), accept: 'text/event-stream' }, signal: ctl.signal }); const d = new TextDecoder(); let buf = '';
  for await (const c of r.body) { buf += d.decode(c, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const f = buf.slice(0, i); buf = buf.slice(i + 2); const data = f.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join(''); if (data) try { ev.push(JSON.parse(data)); } catch {} } } })().catch(() => {});
await j('POST', `/session/${sid}/prompt`, { prompt: [{ type: 'text', text: 'hello' }] }, cid);
await new Promise(r => setTimeout(r, 6000));
const count = (tag, tool) => fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(e => e.ev === 'call' && e.tag === tag && e.tool === tool).length;
const call = (serverName, name) => { console.error('call', serverName, name, new Date().toISOString()); const c = new AbortController(); const t = setTimeout(() => c.abort(), 20000); return fetch(`${base}/session/${sid}/mcp-app/tools/call`, { method: 'POST', headers: H(cid), body: JSON.stringify({ serverName, resourceUri: `ui://${serverName}/dashboard`, name, arguments: {} }), signal: c.signal }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) })).catch(e => ({ status: 'ABORTED-after-20s', pendingPermissionPrompts: ev.filter(x => x.type === 'permission_request').map(x => JSON.stringify(x).match(/mcp__\w+/)?.[0]) })).finally(() => clearTimeout(t)); };
const _unused = (serverName, name) => j('POST', `/session/${sid}/mcp-app/tools/call`, { serverName, resourceUri: `ui://${serverName}/dashboard`, name, arguments: {} }, cid);
const out = {};
const seen = new Set(ev.filter(e => e.type === 'permission_request').map(e => e.data.requestId));
async function callApproving(server, name) {
  const p = call(server, name); let pr;
  for (let i = 0; i < 80 && !pr; i++) { pr = ev.find(e => e.type === 'permission_request' && !seen.has(e.data.requestId) && JSON.stringify(e).includes(`mcp__${server}__${name}`)); if (!pr) await new Promise(r => setTimeout(r, 100)); }
  let vote = null; if (pr) { seen.add(pr.data.requestId); vote = (await j('POST', `/permission/${pr.data.requestId}`, { outcome: { outcome: 'selected', optionId: 'proceed_once' } }, cid)).status; }
  return { permissionRequested: !!pr, approvedVote: vote, res: await p };
}
out.hookDenied = { ...(await callApproving('fixture', 'get_embed_token')), serverExecutions: count('fixture', 'get_embed_token') };
out.ruleDenied = { ...(await callApproving('fixture', 'failing_app_tool')), serverExecutions: count('fixture', 'failing_app_tool') };
out.controlApproved = { ...(await callApproving('other', 'get_embed_token')), serverExecutions: count('other', 'get_embed_token') };
console.log(JSON.stringify(out, null, 1)); fs.writeFileSync(OUT, JSON.stringify(out, null, 1)); ctl.abort(); process.exit(0);
