// VERIFICATION RIG ONLY (PR #13247) S13, trial merge with #13112: a later Turn admitted while a cwd change is open
// and still RUNNING when the change reaches its commit (claim held 4 s by the rig trigger, model holds the Turn 8 s).
import fs from 'node:fs';
import { api, Report, register, createSession, waitTurn, turnRow, sleep, j, RUN } from './lib.mjs';
import { pubChange, opId, waitCwdOp, binding, mkdirWs, ctxEvents } from './cwd.mjs';
const R = new Report(process.env.NAME ?? 's13-reverse-race');
const tag = Date.now() % 100000;
const WS = `ws-s13-${tag}`;
register(WS, 'st-e');
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const c = await createSession('public', WS, 'PLAIN');
const s = c.session;
await waitTurn(s);
mkdirWs('e', `trap-claim-s13-${tag}`);
const a = await pubChange(s, `trap-claim-s13-${tag}`, 1, { key: `s13-${tag}` });
await sleep(400);
const sub = await api('POST', `/v1/agents/sessions/${s}/events`, msg(`G_SLOW name=slow-${tag}.txt hold=8000`), { key: `s13l-${tag}` });
const w = await waitCwdOp(s, opId(a), { timeoutMs: 20_000 });
const t = await waitTurn(s, { timeoutMs: 30_000 });
const where = fs.existsSync(`${RUN}/ws/e/child/slow-${tag}.txt`) ? 'child/' : fs.existsSync(`${RUN}/ws/e/trap-claim-s13-${tag}/slow-${tag}.txt`) ? 'new dir' : 'nowhere';
if (sub.status === 409) R.check('Turn refused 409 session_context_busy during the open change; change completes; no new Turn ran', sub.json.error?.code === 'session_context_busy' && w.json.status === 'completed' && binding(s).rev === 2 && where === 'nowhere', `submit=${sub.status} ${sub.json.error?.code} op=${w.json.status} ${j(binding(s))} file=${where}`);
else R.check('Turn admitted during the open change; change then fails session_context_busy at commit; Turn completes in the old directory; revision unchanged',
  sub.status === 202 && w.json.status === 'failed' && w.json.failure_code === 'session_context_busy' && t.status === 'COMPLETED' && where === 'child/' && binding(s).rev === 1 && ctxEvents(s).length === 0,
  `submit=${sub.status} op=${w.json.status}/${w.json.failure_code ?? ''} turn=${t.status} file=${where} ${j(binding(s))}`);
R.done({ session: s });
