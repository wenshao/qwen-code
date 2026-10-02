// VERIFICATION RIG ONLY (PR #13135): close every prepared Session and report the outcome with full diagnostics.
// usage: DB=.. BASE=.. RUNDIR=.. node closeall.mjs <label> <scenario-name> [waitMs] [expect: completed|blocked|any]
import fs from 'node:fs';
import { RIG, DB, Report, closeSession, getOp, opIdOf, sessStatus, sleep, j, sql, one, registration, procState, fenceRows, STATE_DIR, workersInContainer } from './lib.mjs';
const [label, scen, WAIT = '60000', EXPECT = 'any'] = process.argv.slice(2);
const prep = JSON.parse(fs.readFileSync(`${RIG}/out/${DB}/prep-${label}.json`, 'utf8'));
const rep = new Report(`closeall-${scen}`);
rep.note('state dir', STATE_DIR);
const results = [];
for (const p of prep) {
  const r = await closeSession('public', p.session, { key: `close-${scen}` });
  const op = opIdOf('public', r);
  const start = Date.now();
  let o;
  for (;;) {
    o = await getOp('public', p.session, op);
    if (['completed', 'failed'].includes(o.json.status) || Date.now() - start > Number(WAIT)) break;
    await sleep(500);
  }
  const db = sql(`SELECT state, COALESCE(error_code,''), attempt_count FROM managed_agent_operation WHERE operation_id='${op}'`)[0];
  const b = sql(`SELECT binding_state, drain_requested, COALESCE(LENGTH(drain_receipt_json),0), COALESCE(LENGTH(loss_evidence_json),0), COALESCE(LENGTH(stop_evidence_json),0) FROM qwen_runtime_binding WHERE binding_id='${p.binding}'`)[0];
  const reg = p.resourceId ? registration(p.resourceId) : null;
  const res = { ws: p.ws, session: p.session, admit: r.status, op, apiStatus: o.json.status, apiCode: o.json.error?.code ?? o.json.failure_code ?? '', recovery: o.json.recovery_blocked ?? o.json.recoveryBlocked, dbOp: db, session_status: sessStatus(p.session), binding: b, reg: reg?.state ?? 'missing', oldPid: p.pid, oldProc: procState(p.pid), fence: fenceRows(p.session), waitedMs: Date.now() - start };
  results.push(res);
  const ok = EXPECT === 'any' ? true : EXPECT === 'completed' ? res.apiStatus === 'completed' && res.session_status === 'CLOSED' : res.apiStatus !== 'completed' && res.session_status === 'CLOSING';
  rep.check(`${p.ws}: close -> ${res.apiStatus} (${res.session_status})`, ok, j({ admit: res.admit, code: res.apiCode, dbOp: res.dbOp, binding: res.binding, reg: res.reg, oldPid: `${res.oldPid}:${res.oldProc}`, fence: res.fence, waited: res.waitedMs, body: JSON.stringify(o.json).slice(0, 400) }));
}
rep.note('workers in container', workersInContainer().join(' '));
rep.done({ results });
