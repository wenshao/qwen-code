// VERIFICATION RIG ONLY (PR #13247 R2) S16: the current directory is destroyed; a change away from it must stay reachable,
// and the next later Turn must run in the new directory.
import fs from 'node:fs';
import { api, Report, register, createSession, waitTurn, j, RUN } from './lib.mjs';
import { pubChange, opId, waitCwdOp, binding, mkdirWs } from './cwd.mjs';
const R = new Report(process.env.NAME ?? 's16-destroyed-current');
const ST = process.env.ST ?? 'h';
const tag = Date.now() % 100000;
const WS = `ws-s16-${tag}`;
register(WS, `st-${ST}`);
const root = fs.realpathSync(`${RUN}/ws/${ST}`);
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
mkdirWs(ST, `cur-${tag}`);
mkdirWs(ST, `next-${tag}`);
const c = await createSession('public', WS, 'PLAIN', { cwd: `cur-${tag}` });
await waitTurn(c.session);
fs.rmSync(`${root}/cur-${tag}`, { recursive: true });
const before = await api('POST', `/v1/agents/sessions/${c.session}/events`, msg(`G_WRITE name=x-${tag}.txt content=x`), { key: `s16b-${tag}` });
const tb = before.status === 202 ? await waitTurn(c.session, { timeoutMs: 40_000 }) : null;
R.note('later Turn while the current dir is gone', `${before.status} → ${tb?.status ?? ''} ${tb?.error ?? ''}`);
const a = await pubChange(c.session, `next-${tag}`, binding(c.session).rev, { key: `s16-${tag}` });
const w = await waitCwdOp(c.session, opId(a));
const l = await api('POST', `/v1/agents/sessions/${c.session}/events`, msg(`G_WRITE name=y-${tag}.txt content=y`), { key: `s16l-${tag}` });
const t = l.status === 202 ? await waitTurn(c.session, { timeoutMs: 40_000 }) : null;
R.check('change away from a destroyed current directory completes, and the next Turn writes into the new one', w.json.status === 'completed' && t?.status === 'COMPLETED' && fs.existsSync(`${root}/next-${tag}/y-${tag}.txt`), `${a.status} ${w.json.status}/${w.json.failure_code ?? ''} later=${l.status} ${t?.status ?? l.json.error?.code} file=${fs.existsSync(`${root}/next-${tag}/y-${tag}.txt`)}`);
R.done({});
