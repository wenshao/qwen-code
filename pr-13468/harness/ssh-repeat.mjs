const [base, parent, cwd] = process.argv.slice(2);
const H = (c) => ({ authorization: 'Bearer tok13468', 'content-type': 'application/json', ...(c ? { 'x-qwen-client-id': c } : {}) });
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const ld = await j(await fetch(`${base}/session/${parent}/load`, { method: 'POST', headers: H(), body: JSON.stringify({ cwd }) }));
console.log('load', ld.status, ld.body?.clientId ? 'clientId ok' : JSON.stringify(ld.body));
const out = [];
for (let i = 0; i < 5; i++) {
  const r = await j(await fetch(`${base}/session/${parent}/side-task`, { method: 'POST', headers: H(ld.body.clientId), body: '{}' }));
  out.push(`${r.status}:${r.body?.code}`);
}
console.log('5x side-task', out.join(' '));
const ls = await j(await fetch(`${base}/workspace/${encodeURIComponent(cwd)}/sessions?size=50`, { headers: H() }));
console.log('sessions in ssh workspace after 5 attempts', ls.body.sessions.length);
const s = await j(await fetch(`${base}/session`, { method: 'POST', headers: H(), body: JSON.stringify({ cwd, sessionScope: 'thread' }) }));
console.log('fresh session still admitted', s.status);
