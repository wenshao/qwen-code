import * as O from './obs.mjs';
await O.mockRun(`${O.ARM}-snap2`);
const s = await O.createSession({ sessionScope: undefined });
const sid = s.sessionId;
console.log('base session', sid, '| createdWith: default scope');
await O.prompt(sid, s.clientId, '[[S:slowbg]] launch a slow background probe');
const t0 = Date.now(); let st;
while (Date.now() - t0 < 60000) { st = (await O.api(`/session/${sid}/status`)).json; if (st?.backgroundTurn?.turnId) break; await O.sleep(300); }
console.log('automatic execution active:', !!st?.backgroundTurn, '| hasActivePrompt', st?.hasActivePrompt);
for (const [tag, body] of [
  ['default scope, qwen-live source', { cwd: O.cfg.ws, sourceType: 'qwen-live' }],
  ['default scope, no source', { cwd: O.cfg.ws }],
]) {
  const r = await O.api('/session', { method: 'POST', body });
  const j = r.json ?? {};
  console.log(`${tag} -> ${r.status} | sessionId ${j.sessionId} | attached=${j.attached} | sameAsBase=${j.sessionId === sid}`);
  console.log('   keys:', Object.keys(j).join(','), '| hasActivePrompt:', j.hasActivePrompt, '| backgroundTurn:', j.backgroundTurn ? 'PRESENT' : 'absent');
}
process.exit(0);
