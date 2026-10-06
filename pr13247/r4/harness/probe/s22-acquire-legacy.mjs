// VERIFICATION RIG ONLY (PR #13247 R4) S22: the acquire path keeps its legacy terminal verdicts (R6 fix 7f1b9cb5d4).
// A committed cwd whose ancestor later becomes a regular file (ENOTDIR) or a dangling symlink: the next later Turn must
// fail fast and typed, hold no storage, and leave the Session recoverable.
import fs from 'node:fs';
import { api, Report, register, createSession, waitTurn, turnRow, j, sql, RUN } from './lib.mjs';
import { pubChange, opId, waitCwdOp, binding, mkdirWs } from './cwd.mjs';
const R = new Report(process.env.NAME ?? 's22-acquire-legacy');
const ST = process.env.ST ?? 'f';
const tag = Date.now() % 100000;
const WS = `ws-s22-${tag}`;
register(WS, `st-${ST}`);
const root = fs.realpathSync(`${RUN}/ws/${ST}`);
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const leases = () => Number(sql(`SELECT COUNT(*) FROM managed_workspace_execution_lease WHERE runtime_session_id IS NOT NULL`)[0][0]);
for (const [label, breakIt] of [
  ['ancestor replaced by a regular file (ENOTDIR)', (a) => { fs.rmSync(a, { recursive: true }); fs.writeFileSync(a, 'x'); }],
  ['ancestor replaced by a dangling symlink', (a) => { fs.rmSync(a, { recursive: true }); fs.symlinkSync(`${a}-nowhere`, a); }],
]) {
  const i = label.includes('ENOTDIR') ? 'f' : 'd';
  const c = await createSession('public', WS, 'PLAIN'); await waitTurn(c.session);
  const s = c.session;
  mkdirWs(ST, `s22${i}-${tag}/lib`);
  const a = await pubChange(s, `s22${i}-${tag}/lib`, 1, { key: `s22-${i}-${tag}` });
  const w = await waitCwdOp(s, opId(a));
  breakIt(`${root}/s22${i}-${tag}`);
  const t0 = Date.now();
  const l = await api('POST', `/v1/agents/sessions/${s}/events`, msg(`G_WRITE name=x-${tag}.txt content=x`), { key: `s22l-${i}-${tag}` });
  const t = l.status === 202 ? await waitTurn(s, { timeoutMs: 120_000 }) : null;
  const ms = Date.now() - t0;
  R.check(`${label}: change ${w.json.status}; next later Turn fails fast and typed, no lease held`, w.json.status === 'completed' && t?.status === 'FAILED' && ms < 15_000 && leases() === 0, `turn=${l.status}/${t?.status} ${t?.error ?? ''} in ${ms} ms, held leases=${leases()} last=${j(turnRow(s).at(-1))}`);
  fs.rmSync(`${root}/s22${i}-${tag}`, { recursive: true, force: true });
  const back = await pubChange(s, 'child', binding(s).rev, { key: `s22b-${i}-${tag}` });
  const wb = await waitCwdOp(s, opId(back));
  const l2 = await api('POST', `/v1/agents/sessions/${s}/events`, msg(`G_WRITE name=y-${tag}.txt content=y`), { key: `s22l2-${i}-${tag}` });
  const t2 = l2.status === 202 ? await waitTurn(s) : null;
  R.check(`${label}: recoverable — change back to child, next Turn completes there`, wb.json.status === 'completed' && t2?.status === 'COMPLETED' && fs.existsSync(`${root}/child/y-${tag}.txt`), `${wb.json.status} turn=${t2?.status}`);
}
R.done({});
