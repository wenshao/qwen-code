// After a daemon restart: persisted side-task catalog, load the same child,
// prompt it, and check what context the model receives. No duplicates.
import fs from 'node:fs';
const [base, token, matrixJson, out] = process.argv.slice(2);
const { ids } = JSON.parse(fs.readFileSync(matrixJson, 'utf8'));
const SECONDARY = process.env.SECONDARY, PRIMARY = process.env.PRIMARY, LOG = process.env.LOG;
const H = (c, x = {}) => ({ authorization: `Bearer ${token}`, ...(c ? { 'x-qwen-client-id': c } : {}), ...x });
const call = async (m, p, { clientId, body } = {}) => {
  const r = await fetch(base + p, { method: m, headers: H(clientId, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, body: j };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const steps = [];
const step = (name, d) => { steps.push({ name, ...d }); console.log(name, JSON.stringify(d).slice(0, 500)); };
const list = (cwd, q) => call('GET', `/workspace/${encodeURIComponent(cwd)}/sessions?${new URLSearchParams({ size: '50', ...q })}`);
const l1 = await list(SECONDARY, { sourceType: 'side_task', sourceId: ids.parent });
step('R1 persisted catalog after restart', { status: l1.status, ids: l1.body.sessions?.map((s) => s.sessionId), expect: [ids.child1, ids.child2] });
const ld = await call('POST', `/session/${ids.child1}/load`, { body: { cwd: SECONDARY } });
step('R2 load child1', { status: ld.status, sessionId: ld.body.sessionId, workspaceCwd: ld.body.workspaceCwd, sameId: ld.body.sessionId === ids.child1 });
const clientId = ld.body.clientId;
const ac = new AbortController();
let done = false; let promptId;
(async () => {
  const r = await fetch(`${base}/session/${ids.child1}/events`, { headers: H(clientId, { accept: 'text/event-stream' }), signal: ac.signal });
  const dec = new TextDecoder(); let buf = '';
  try { for await (const c of r.body) { buf += dec.decode(c, { stream: true }); if (promptId && buf.includes('turn_complete') && buf.includes(promptId)) done = true; } } catch {}
})();
await sleep(300);
const pr = await call('POST', `/session/${ids.child1}/prompt`, { clientId, body: { prompt: [{ type: 'text', text: 'What is the codeword after restore? AFTER-RESTORE' }] } });
promptId = pr.body.promptId;
for (let i = 0; i < 120 && !done; i++) await sleep(250);
ac.abort();
const reqs = fs.readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.kind === 'main' && l.lastUser?.includes('AFTER-RESTORE'));
step('R3 restored child prompt', { status: pr.status, turnComplete: done, markers: reqs.at(-1)?.markers, reply: reqs.at(-1)?.reply });
const l2 = await list(SECONDARY, { sourceType: 'side_task', sourceId: ids.parent });
const all = await list(SECONDARY, {});
step('R4 catalog after load+prompt (no duplicates)', { ids: l2.body.sessions?.map((s) => s.sessionId), totalSecondarySessions: all.body.sessions?.length });
const lp = await list(PRIMARY, { sourceType: 'side_task', sourceId: ids.parent });
step('R5 primary catalog for secondary parent', { ids: lp.body.sessions?.map((s) => s.sessionId) });
fs.writeFileSync(out, JSON.stringify({ ids, steps }, null, 2));
