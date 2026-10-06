// Register an ssh:// workspace on a real daemon, open a session in it and try
// POST /session/:id/side-task. usage: node ssh-check.mjs <daemonUrl> <out>
import fs from 'node:fs';
const [base, out] = process.argv.slice(2);
const token = 'tok13468';
const H = (c, x = {}) => ({ authorization: `Bearer ${token}`, ...(c ? { 'x-qwen-client-id': c } : {}), ...x });
const call = async (m, p, { clientId, body } = {}) => {
  const r = await fetch(base + p, { method: m, headers: H(clientId, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, body: j };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const steps = [];
const step = (name, d) => { steps.push({ name, ...d }); console.log(name, JSON.stringify(d).slice(0, 600)); };
for (let i = 0; i < 60; i++) { if ((await call('GET', '/capabilities')).status === 200) break; await sleep(500); }
const reg = await call('POST', '/workspaces', { body: { cwd: 'ssh://root@127.0.0.1:22468/root/verify/pr13468/ssh/remote' } });
step('register ssh workspace', { status: reg.status, body: reg.body });
let ws;
for (let i = 0; i < 40; i++) {
  const caps = await call('GET', '/capabilities');
  ws = caps.body.workspaces?.find((w) => w.ssh);
  if (ws?.trusted) break; await sleep(500);
}
step('capabilities ssh entry', { ws });
const s = await call('POST', '/session', { body: { cwd: ws.cwd, sessionScope: 'thread' } });
step('create session in ssh workspace', { status: s.status, sessionId: s.body.sessionId, workspaceCwd: s.body.workspaceCwd, code: s.body.code });
const parent = s.body.sessionId, clientId = s.body.clientId;
const pr = await call('POST', `/session/${parent}/prompt`, { clientId, body: { prompt: [{ type: 'text', text: 'hello from ssh workspace' }] } });
step('prompt ssh parent', { status: pr.status });
await sleep(4000);
const st = await call('POST', `/session/${parent}/side-task`, { clientId, body: { name: 'SSH side task' } });
step('side-task on ssh parent', { status: st.status, body: st.body });
const br = await call('POST', `/session/${parent}/branch`, { clientId, body: {} });
step('branch on ssh parent (still restricted)', { status: br.status, code: br.body.code });
const ls = await call('GET', `/workspace/${encodeURIComponent(ws.cwd)}/sessions?${new URLSearchParams({ size: '50', sourceType: 'side_task', sourceId: parent })}`);
step('ssh side-task catalog', { status: ls.status, ids: ls.body.sessions?.map((x) => x.sessionId) });
const all = await call('GET', `/workspace/${encodeURIComponent(ws.cwd)}/sessions?size=50`);
step('ssh workspace all sessions', { ids: all.body.sessions?.map((x) => x.sessionId) });
fs.writeFileSync(out, JSON.stringify({ ws, parent, steps }, null, 2));
