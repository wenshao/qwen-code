import * as O from './obs.mjs';
await O.mockRun(`${O.ARM}-snap3`);
const cid = 'live-probe-fixed-client';
const mk = (body) => O.api('/session', { method: 'POST', clientId: cid, body });
// Exactly the request the shipped adaptor issues.
const base = { cwd: O.cfg.ws, sessionScope: 'thread', sourceType: 'qwen-live' };
const first = await mk(base);
console.log('1st adaptor-shaped request ->', first.json?.sessionId, 'attached=', first.json?.attached);
const sid = first.json.sessionId;
await O.prompt(sid, first.json.clientId, '[[S:slowbg]] launch a slow background probe');
const t0 = Date.now(); let st;
while (Date.now() - t0 < 60000) { st = (await O.api(`/session/${sid}/status`)).json; if (st?.backgroundTurn?.turnId) break; await O.sleep(300); }
console.log('automatic execution active on that session:', !!st?.backgroundTurn);
for (const [tag, body] of [
  ['same request again (adaptor shape)', base],
  ['adaptor shape + sourceId', { ...base, sourceId: 'live-1' }],
  ['adaptor shape + sourceId (repeat)', { ...base, sourceId: 'live-1' }],
]) {
  const r = await mk(body);
  const j = r.json ?? {};
  console.log(`${tag} -> ${r.status} attached=${j.attached} same=${j.sessionId === sid} backgroundTurn=${j.backgroundTurn ? 'PRESENT' : 'absent'} hasActivePrompt=${j.hasActivePrompt}`);
}
process.exit(0);
