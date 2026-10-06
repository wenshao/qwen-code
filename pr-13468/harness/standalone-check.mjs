// Real daemon: create a standalone (no-workspace) session and try side-task.
import { randomUUID } from 'node:crypto';
const [base] = process.argv.slice(2);
const H = (c) => ({ authorization: 'Bearer tok13468', 'content-type': 'application/json', ...(c ? { 'x-qwen-client-id': c } : {}) });
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const caps = await j(await fetch(`${base}/capabilities`, { headers: H() }));
console.log('standalone feature', caps.body.features.filter((f) => /standalone/.test(f)));
const sid = randomUUID();
const s = await j(await fetch(`${base}/standalone/sessions`, { method: 'POST', headers: H(), body: JSON.stringify({ sessionId: sid }) }));
console.log('create standalone', s.status, JSON.stringify(s.body).slice(0, 260));
const clientId = s.body?.clientId ?? s.body?.session?.clientId;
const st = await j(await fetch(`${base}/session/${sid}/side-task`, { method: 'POST', headers: H(clientId), body: '{}' }));
console.log('side-task on standalone', st.status, JSON.stringify(st.body));
