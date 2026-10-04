// VERIFICATION RIG ONLY (PR #13247) S10: attribution — does a G0 initial Turn into a mode-000 directory wedge the same way?
import fs from 'node:fs';
import { Report, register, createSession, waitTurn, turnRow, j, sql, RUN } from './lib.mjs';
const R = new Report(process.env.NAME ?? 's10-g0-locked');
const ST = process.env.ST ?? 'f';
const tag = Date.now() % 100000;
const WS = `ws-s10-${tag}`;
register(WS, `st-${ST}`);
const dir = `${RUN}/ws/${ST}/locked-g0-${tag}`;
fs.mkdirSync(dir, { recursive: true });
fs.chmodSync(dir, 0o000);
const c = await createSession('public', WS, `G_WRITE name=g0-${tag}.txt content=g0`, { cwd: `locked-g0-${tag}` });
const t = await waitTurn(c.session, { timeoutMs: Number(process.env.WAIT ?? 60000) });
fs.chmodSync(dir, 0o755);
const lease = sql(`SELECT COUNT(*) FROM managed_workspace_execution_lease WHERE runtime_session_id IS NOT NULL`)[0][0];
R.note(`G0 create with cwd = mode-000 dir`, `create=${c.status} ${c.json.error?.code ?? ''} turn=${t.status} ${t.error ?? ''} after ${t.ms} ms (timeout=${!!t.timeout}) held storage leases=${lease} last=${j(turnRow(c.session).at(-1))}`);
R.done({ session: c.session, WS });
