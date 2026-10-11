// VERIFICATION RIG ONLY (PR #13673): fail-closed control. The original End command Hook hangs; its worker (and the
// Hook's cgroup unit) disappear while End is unresolved. Retirement must stay blocked: no Delete Hook, no retirement,
// holder retained, no stop receipt. usage: DB=.. ARM=.. OBSERVE_MS=60000 node p-unknown.mjs
import * as L from './lib.mjs';
import fs from 'node:fs';

const OBSERVE = Number(process.env.OBSERVE_MS ?? 60_000);
const R = new L.Report('unknown-end');
const REC = `${L.LOGD}/hooks-rec.jsonl`;
const recs = (s) => (fs.existsSync(REC) ? fs.readFileSync(REC, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.session === s) : []);
const opFull = async (op) => (await L.sql('SELECT state, delivery_state AS delivery, COALESCE(error_code,"") AS err, claim_generation AS gen, attempt_count AS attempts, IF(lifecycle_effects_receipt_json IS NULL,0,1) AS effects FROM managed_agent_operation WHERE operation_id=?', [op]))[0];
const holderRows = () => L.sql("SELECT storage_id AS st, holder_key IS NOT NULL AS held, runtime_session_id AS rs FROM managed_workspace_execution_lease WHERE storage_kind='LOCAL' ORDER BY storage_id");

await L.ensureWorkspace('ws-a', 'st-a');
const pin = JSON.parse(fs.readFileSync(`${L.LOGD}/hook-pin.json`, 'utf8'));
L.setTapRules([{ match: '^POST /session$', action: 'inject', merge: { hookCatalog: pin }, times: 1 }]);
const tg = await L.createSession('public', 'ws-a', `G_WRITE name=target-${Date.now().toString(36)}.txt content=target`);
const tt = await L.waitTurns(tg.session, 1);
L.setTapRules([]);
const T = tg.session;
R.check('target Session with original command Hook catalog created, first Turn completes', tt.rows.at(-1)?.status === 'COMPLETED', tt.rows.at(-1));
const w = await L.workerOf(T);
const ctl = `${L.LOGD}/hookctl/hang-SessionEnd`;
fs.writeFileSync(ctl, '1');
const d = await L.del('public', T);
const op = L.opIdOf('public', d);
const entered = await L.waitFor(async () => recs(T).some((e) => e.event === 'SessionEnd' && e.phase === 'enter'), 90_000, 200);
const hookPid = recs(T).find((e) => e.event === 'SessionEnd')?.pid;
const unit = recs(T).find((e) => e.event === 'SessionEnd')?.cgroup?.replace(/^0::/, '');
R.check('End command Hook entered and is hanging (outcome unresolved)', !!entered.v, { hookPid, unit, op: await opFull(op) });
// The worker and the Hook's own unit disappear.
const killed = [];
try { process.kill(w.pid, 'SIGKILL'); killed.push(`worker ${w.pid}`); } catch (e) { killed.push(`worker ${w.pid} ${e.code}`); }
if (unit) { try { fs.writeFileSync(`/sys/fs/cgroup${unit}/cgroup.kill`, '1'); killed.push(`cgroup.kill ${unit}`); } catch (e) { killed.push(`cgroup.kill ${e.code}`); } }
fs.rmSync(ctl, { force: true });
await L.sleep(500);
R.note('fault', { killed, workerAlive: L.alive(w.pid), hookAlive: hookPid ? L.alive(hookPid) : null });
const t0 = Date.now();
const timeline = []; let last = '';
while (Date.now() - t0 < OBSERVE) {
  const o = await opFull(op);
  const key = `${o?.state}/${o?.delivery}/${o?.err}/g${o?.gen}/effects=${o?.effects}`;
  if (key !== last) { timeline.push(`+${((Date.now() - t0) / 1000).toFixed(1)}s ${key}`); last = key; }
  if (['COMPLETED', 'FAILED'].includes(o?.state)) break;
  await L.sleep(1000);
}
R.note(`operation timeline over ${OBSERVE / 1000}s`, timeline);
const o = await opFull(op);
const sr = await L.sessRow(T);
const hk = recs(T);
const b = (await L.bindings(T)).at(-1);
const holders = await holderRows();
R.check('operation not COMPLETED and Session not DELETED (fails closed)', o?.state !== 'COMPLETED' && sr?.status !== 'DELETED', { op: o, session: sr?.status });
R.check('no effects receipt persisted', Number(o?.effects) === 0, { effects: o?.effects });
R.check('End entered once, never re-run; Delete Hook never entered', hk.length === 1 && hk[0].event === 'SessionEnd' && hk[0].phase === 'enter', hk.map((e) => `${e.event}:${e.phase}`));
R.check('no retirement row', (await L.retirement(T)).length === 0);
R.check('no stop receipt on the original binding', b && Number(b.drainRcpt) === 0, b);
R.check('storage holder still retained by the original Hook RuntimeSession', holders.some((h) => Number(h.held) === 1 && String(h.rs).startsWith('hooks-activation-')), holders);
R.done({ timeline });
await L.closeDb();
