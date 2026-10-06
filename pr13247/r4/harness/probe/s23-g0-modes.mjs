// VERIFICATION RIG ONLY (PR #13247 R4) S23: the acquire path's own access checks (G0 creation straight into
// directories the worker cannot read or search). Each mode on its own fresh storage.
import fs from 'node:fs';
import { Report, register, createSession, waitTurn, turnRow, j, sql, RUN } from './lib.mjs';
const R = new Report(process.env.NAME ?? 's23-g0-modes');
const tag = Date.now() % 100000;
const MODES = [['111 (search, no read)', 0o111, 'e'], ['444 (read, no search)', 0o444, 'g'], ['000', 0o000, 'h']];
for (const [label, mode, st] of MODES) {
  const WS = `ws-s23-${st}-${tag}`;
  register(WS, `st-${st}`);
  const dir = `${RUN}/ws/${st}/g0-${tag}`;
  fs.mkdirSync(dir); fs.chmodSync(dir, mode);
  const c = await createSession('public', WS, `G_WRITE name=g0-${tag}.txt content=x`, { cwd: `g0-${tag}` });
  const t = await waitTurn(c.session, { timeoutMs: Number(process.env.WAIT ?? 30000) });
  fs.chmodSync(dir, 0o755);
  const leases = Number(sql(`SELECT COUNT(*) FROM managed_workspace_execution_lease WHERE runtime_session_id IS NOT NULL`)[0][0]);
  R.check(`G0 into a ${label} dir → typed failure, no lease held`, t.status === 'FAILED' && !t.timeout && leases === 0, `create=${c.status} turn=${t.status} ${t.error ?? ''} after ${t.ms} ms (timeout=${!!t.timeout}) leases=${leases} last=${j(turnRow(c.session).at(-1))}`);
}
R.done({});
