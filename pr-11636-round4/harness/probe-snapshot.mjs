// Does `POST /session` (createOrAttachSession) ever hand back a snapshot that
// carries `backgroundTurn` — the field R6-5's fix seeds from?
import * as O from './obs.mjs';
await O.mockRun(`${O.ARM}-snap`);
const s = await O.createSession();
const sid = s.sessionId;
console.log('base session', sid);
await O.prompt(sid, s.clientId, '[[S:slowbg]] launch a slow background probe');
const t0 = Date.now();
let st;
while (Date.now() - t0 < 60000) {
  st = (await O.api(`/session/${sid}/status`)).json;
  if (st?.backgroundTurn?.turnId) break;
  await O.sleep(300);
}
console.log('status during automatic execution:', JSON.stringify({ hasActivePrompt: st?.hasActivePrompt, backgroundTurn: st?.backgroundTurn?.turnId?.slice(-12) }));

for (const body of [
  { cwd: O.cfg.ws, sessionScope: 'thread', sourceType: 'qwen-live' },
  { cwd: O.cfg.ws, sessionScope: 'workspace', sourceType: 'qwen-live' },
]) {
  const r = await O.api('/session', { method: 'POST', clientId: s.clientId, body });
  const j = r.json ?? {};
  console.log(`POST /session ${JSON.stringify(body.sessionScope)} -> status ${r.status}`);
  console.log('   sessionId:', j.sessionId, '| same as base:', j.sessionId === sid);
  console.log('   keys:', Object.keys(j).join(','));
  console.log('   hasActivePrompt:', j.hasActivePrompt, '| backgroundTurn:', JSON.stringify(j.backgroundTurn ?? null));
}
// And the documented attach route
const l = await O.api(`/session/${sid}/load`, { method: 'POST', clientId: s.clientId, body: { historyPageSize: 5 } });
console.log('POST /session/:id/load keys:', Object.keys(l.json ?? {}).join(','));
console.log('   hasActivePrompt:', l.json?.hasActivePrompt, '| backgroundTurn:', JSON.stringify(l.json?.backgroundTurn ?? null));
process.exit(0);
