// VERIFICATION RIG ONLY (PR #13135): create N bound Sessions, each with a completed file Turn, on distinct Workspaces.
// usage: DB=.. BASE=.. RUNDIR=.. node prep.mjs <label> <ws-prefix> <letters e.g. f,g,h>   -> writes out/<db>/prep-<label>.json
import fs from 'node:fs';
import { RIG, DB, createSession, waitTurn, ensureWorkspace, bindingOf, handleOf, registration, procState, lxWs } from './lib.mjs';
const [label, prefix, letters] = process.argv.slice(2);
const out = [];
for (const st of letters.split(',')) {
  const ws = `${prefix}-${st}`;
  ensureWorkspace(ws, `st-${st}`);
  const c = await createSession('public', ws, `G_FILES name=proof.txt tag=${st}`);
  const t = await waitTurn(c.session);
  const [b] = bindingOf(c.session);
  const h = b ? handleOf(b[0]) : null;
  const reg = h ? registration(h.resourceId) : null;
  const row = { ws, st, session: c.session, turn: t.status, binding: b?.[0], bindingState: b?.[1], resourceId: h?.resourceId, pid: reg?.pid ?? 0, regState: reg?.state, proc: procState(reg?.pid ?? 0), file: lxWs(st, 'child/proof.txt'), handle: h };
  out.push(row);
  console.log(JSON.stringify({ ws, session: row.session, turn: row.turn, binding: row.bindingState, pid: row.pid, proc: row.proc, file: row.file }));
}
fs.mkdirSync(`${RIG}/out/${DB}`, { recursive: true });
fs.writeFileSync(`${RIG}/out/${DB}/prep-${label}.json`, JSON.stringify(out, null, 2));
