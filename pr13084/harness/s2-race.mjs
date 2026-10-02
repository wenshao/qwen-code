// s2: a writer that acquires between the coordinator's settle() writer check and completeOperation's commit.
// The relay holds one completeOperation statement for 10 s (nothing is changed in the jar).
//   MODE=writer-first   hold completeOperation's first statement (before any lock)          [head]
//   MODE=deletion-first hold the operation row FOR UPDATE (after lockDeletion + session row)  [head, base]
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
const MODE = process.env.MODE, ARM = process.env.ARM;
L.openLog(`s2-race-${ARM}-${MODE}`);
const out = { arm: ARM, mode: MODE };
const M = await L.makeOutput(`race-${MODE}`, `ws-race-${ARM}-${MODE}`, process.env.ST ?? 'st-s10', L.genCmd(`race-${MODE}`, 1024 * 1024, 0, 0));
const sid = M.session, ws = L.sessionWs(sid);
L.say('made', { sid, turn: M.turn.status, results: M.results, head: L.headRow(sid) });
const op = `op_rig_race_${Date.now().toString(36)}`;
const base = `managed_agent_operation WHERE tenant_id = 't-o41' AND\\s*session_id = '${sid}' AND\\s*operation_id = '${op}'`;
const arm = MODE === 'writer-first' ? { re: `^SELECT \\* FROM ${base}\\s*$`, skip: 1, ms: 10000 } : { re: `^SELECT \\* FROM ${base} FOR UPDATE`, skip: 0, ms: 10000 };
fs.writeFileSync(`${L.R}/run/sqltap-arm.json`, JSON.stringify(arm));
process.kill(Number(fs.readFileSync(`${L.R}/run/sqltap.pid`, 'utf8')), 'SIGUSR2');
await L.sleep(300);
const t0 = Date.now();
execFileSync(`${L.R}/op.sh`, [sid, 'DELETE', '0'], { env: { ...process.env, OPID: op, DB: L.DB } });
const tapLog = () => fs.readFileSync(`${L.R}/run/sqltap.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.t >= t0);
let stalled = null;
for (let i = 0; i < 200 && !stalled; i++) { stalled = tapLog().find((e) => e.result.startsWith('STALLED')); if (!stalled) await L.sleep(100); }
L.say('stalled', stalled ? `+${stalled.t - t0} ms ${stalled.sql.slice(0, 160)}` : 'NEVER');
out.headAtStall = L.headRow(sid);
L.say('head-at-stall', out.headAtStall);
const ta = Date.now();
const w = await L.acquire(sid, ws, { leaseMillis: 15_000 });
const acquiredAt = Date.now();
L.say('acquire', `${w.status} ${w.code ?? ''} after ${acquiredAt - ta} ms (+${acquiredAt - t0} ms) ${JSON.stringify(w.json).slice(0, 140)}`);
out.acquire = { status: w.status, code: w.code ?? null, waitedMs: acquiredAt - ta };
let st;
for (let i = 0; i < 400; i++) { st = L.sql(`SELECT state, attempt_count, IFNULL(completed_at,0) FROM managed_agent_operation WHERE operation_id='${op}'`)[0]; if (st[0] === 'COMPLETED') break; await L.sleep(250); }
const lease = L.one(`SELECT IFNULL(UNIX_TIMESTAMP(writer_lease_until)*1000,0) FROM qwen_managed_session_journal_head WHERE session_id='${sid}'`);
out.op = { state: st[0], attempts: +st[1], completedAfterMs: +st[2] ? +st[2] - t0 : null };
L.say('op', `${st[0]} attempts=${st[1]} completed=+${+st[2] ? +st[2] - t0 : '-'} ms; writer lease would end at +${w.json?.leaseUntil ? w.json.leaseUntil - t0 : '-'} ms`);
out.session = L.one(`SELECT status FROM managed_agent_session WHERE session_id='${sid}'`);
out.head = L.headRow(sid);
out.retirement = (() => { try { return L.retirement(sid); } catch { return 'no table'; } })();
L.say('after', { session: out.session, head: out.head, retirement: out.retirement });
if (w.status === 200) {
  const rs = await L.storeCall('GET', sid, 'restore', { token: w.token, query: `?workspaceId=${ws}` });
  const rn = await L.storeCall('POST', sid, 'writers:renew', { token: w.token, body: { workspaceId: ws, writerId: w.writerId, writerGeneration: w.json.writerGeneration, leaseMillis: 15000 } });
  out.afterDelete = { restore: `${rs.status} ${rs.code ?? rs.json?.state ?? ''}`, renew: `${rn.status} ${rn.code ?? ''}` };
  L.say('writer-after-delete', out.afterDelete);
}
let retries = []; try { retries = execFileSync('/usr/bin/grep', ['-h', op, ...fs.readdirSync(`${L.S}/logs`).filter((f) => f.startsWith(`spring-${process.env.JAR}-${L.DB}.log`)).map((f) => `${L.S}/logs/${f}`)], { encoding: 'utf8' }).split('\n').filter((l) => /will retry/.test(l)).map((l) => l.replace(/^.*retry=/, 'retry=').slice(0, 220)); } catch {}
out.retries = retries;
L.say('retries', retries);
L.out(`s2-${ARM}-${MODE}.json`, out);
