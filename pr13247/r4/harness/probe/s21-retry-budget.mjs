// VERIFICATION RIG ONLY (PR #13247 R4) S21: the 8-attempt probe budget on a real stack. ENAMETOOLONG is the only
// retryable probe shape reachable on this host: a lexically valid cwd (≤ 1024 code points) with one component over
// NAME_MAX (255 bytes). Measures how long the creator's Session stays busy and how it ends.
import { api, Report, register, createSession, waitTurn, sleep, j, sql } from './lib.mjs';
import { pubChange, opId, pubOp, binding, cwdOpRow, mkdirWs, ctxEvents } from './cwd.mjs';
const R = new Report(process.env.NAME ?? 's21-retry-budget');
const tag = Date.now() % 100000;
const WS = `ws-s21-${tag}`;
register(WS, 'st-h');
mkdirWs('h', 'child2');
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const shapes = (process.env.SHAPES ?? 'ascii,cjk').split(',');
for (const shape of shapes) {
  const c = await createSession('public', WS, 'PLAIN'); await waitTurn(c.session);
  const s = c.session;
  const target = shape === 'cjk' ? '目'.repeat(86) : 'a'.repeat(300); // 258 / 300 bytes in one component
  const t0 = Date.now();
  const a = await pubChange(s, target, 1, { key: `s21-${shape}-${tag}` });
  const samples = [];
  let busyTurn = null, busyChange = null, end = null;
  for (;;) {
    const r = await pubOp(s, opId(a));
    const row = cwdOpRow(opId(a));
    if (!samples.length || samples.at(-1).attempts !== row.attempts || samples.at(-1).status !== r.json.status) samples.push({ t: Math.round((Date.now() - t0) / 1000), status: r.json.status, attempts: row.attempts });
    if (!busyTurn && row.attempts >= 2) {
      busyTurn = await api('POST', `/v1/agents/sessions/${s}/events`, msg('PLAIN'), { key: `s21t-${shape}-${tag}` });
      busyChange = await pubChange(s, 'child2', 1, { key: `s21o-${shape}-${tag}` });
    }
    if (['completed', 'failed'].includes(r.json.status)) { end = r.json; break; }
    if (Date.now() - t0 > 600_000) { end = { status: 'TIMEOUT' }; break; }
    await sleep(1000);
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  R.note(`${shape}: attempt timeline`, j(samples));
  R.check(`${shape}: lexically valid (202), then retried through the budget and ended FAILED workspace_unavailable (attempt_count 7 → 8 probes)`, a.status === 202 && end.status === 'failed' && end.failure_code === 'workspace_unavailable' && cwdOpRow(opId(a)).attempts === 7, `${a.status} → ${end.status}/${end.failure_code} after ${secs} s, attempts=${cwdOpRow(opId(a)).attempts}`);
  R.note(`${shape}: the Session meanwhile`, `later Turn ${busyTurn?.status} ${busyTurn?.json.error?.code ?? ''}; another change ${busyChange?.status} ${busyChange?.json.error?.code ?? ''}; held busy ≈ ${secs} s`);
  const after = await api('POST', `/v1/agents/sessions/${s}/events`, msg('PLAIN'), { key: `s21a-${shape}-${tag}` });
  const ta = after.status === 202 ? await waitTurn(s) : null;
  R.check(`${shape}: afterwards the Session is unchanged and usable`, binding(s).rev === 1 && ctxEvents(s).length === 0 && after.status === 202 && ta?.status === 'COMPLETED', `${j(binding(s))} later=${after.status} ${ta?.status}`);
}
R.done({});
