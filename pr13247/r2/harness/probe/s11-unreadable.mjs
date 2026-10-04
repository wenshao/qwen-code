// VERIFICATION RIG ONLY (PR #13247) S11: repeated A/B — cwd change to a directory the worker cannot read/search, then a later Turn.
// Each trial uses its own storage so a wedged trial cannot contaminate the next.
import fs from 'node:fs';
import { api, Report, register, createSession, waitTurn, turnRow, sleep, j, sql, RUN } from './lib.mjs';
import { pubChange, opId, waitCwdOp, binding } from './cwd.mjs';
const R = new Report(process.env.NAME ?? 's11-unreadable');
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const MODES = [['000', 0o000], ['444 (read, no search)', 0o444], ['111 (search, no read)', 0o111]];
const STS = (process.env.STS ?? 'e,g,h').split(',');
const out = [];
for (const [i, st] of STS.entries()) {
  const [mlabel, mode] = MODES[i % MODES.length];
  const tag = `${Date.now() % 100000}-${i}`;
  const WS = `ws-s11-${tag}`;
  register(WS, `st-${st}`);
  const c = await createSession('public', WS, 'PLAIN');
  await waitTurn(c.session);
  const dir = `${RUN}/ws/${st}/locked-${tag}`;
  fs.mkdirSync(dir);
  fs.chmodSync(dir, mode);
  const a = await pubChange(c.session, `locked-${tag}`, 1, { key: `s11-${tag}` });
  const w = await waitCwdOp(c.session, opId(a));
  const sub = await api('POST', `/v1/agents/sessions/${c.session}/events`, msg(`G_WRITE name=x-${tag}.txt content=x`), { key: `s11l-${tag}` });
  const t = await waitTurn(c.session, { timeoutMs: 30_000 });
  const nb = await createSession('public', WS, `G_WRITE name=nb-${tag}.txt content=nb`, { actor: 'carol' });
  const tn = await waitTurn(nb.session, { timeoutMs: 30_000 });
  const again = await pubChange(c.session, 'child', binding(c.session).rev, { key: `s11b-${tag}` });
  fs.chmodSync(dir, 0o755);
  const row = { st, mode: mlabel, change: `${w.json.status}${w.json.failure_code ? '/' + w.json.failure_code : ''}`, laterTurn: `${sub.status}→${t.status}${t.error ? '/' + t.error : ''}${t.timeout ? ' (still after 30 s)' : ''}`, neighbour: `${tn.status}${tn.error ? '/' + tn.error : ''}`, nextChange: `${again.status} ${again.json.error?.code ?? again.json.status}` };
  out.push(row);
  R.note(`trial ${i} st-${st} mode ${mlabel}`, j(row));
}
R.done({ out });
