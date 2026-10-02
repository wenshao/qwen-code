// s3: in-flight public downloads vs. the fixed read lease, a paused JVM and Session deletion.
//   MODE=expire   throttled OSS (256 KiB/s) full download of a 64 MiB artifact; watch where it stops
//   MODE=sigstop  same, SIGSTOP the Spring JVM at +5 s for 125 s; count OSS GETs after SIGCONT
//   MODE=delete   same, seam DELETE at +10 s; count OSS GETs and bytes after the retirement commit
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
const MODE = process.env.MODE, ARM = process.env.ARM, SIZE = Number(process.env.SIZE ?? 64 * 1024 * 1024);
L.openLog(`s3-${ARM}-${MODE}${process.env.SUFFIX ?? ''}`);
await L.throttle(0);
const M = await L.makeOutput(`reads-${MODE}`, `ws-s3-${ARM}-${MODE}${process.env.SUFFIX ?? ''}`, process.env.ST ?? 'st-s20', L.genCmd(`s3${MODE}`, SIZE, 0, 0));
const a = M.arts.find((x) => x.stream_role === 'stdout');
L.say('made', { session: M.session, turn: M.turn.status, results: M.results, bytes: a?.byte_length, readTimeout: process.env.READ_TIMEOUT ?? 'default(2m)' });
await L.throttle(Number(process.env.BPS ?? 262144));
const t0 = Date.now();
const progress = { bytes: 0 };
const dl = L.streamDownload(M.session, a, { progress });
let event = null;
if (MODE === 'sigstop') {
  await L.sleep(5000);
  const pid = L.springPid();
  process.kill(pid, 'SIGSTOP'); const stoppedAt = Date.now() - t0;
  await L.sleep(125_000);
  process.kill(pid, 'SIGCONT'); event = { name: 'SIGCONT', at: Date.now() - t0, stoppedAt, bytesAtEvent: progress.bytes };
} else if (MODE === 'delete') {
  await L.sleep(10_000);
  execFileSync(`${L.R}/op.sh`, [M.session, 'DELETE', '0'], { env: { ...process.env, DB: L.DB }, encoding: 'utf8' });
  const insertedAt = Date.now() - t0;
  let done = null;
  for (let i = 0; i < 600 && !done; i++) {
    await L.sleep(100);
    const st = L.one(`SELECT CONCAT(status) FROM managed_agent_session WHERE session_id='${M.session}'`);
    if (st === 'DELETED') done = { at: Date.now() - t0, bytes: progress.bytes };
  }
  let retiredAt = null;
  try { retiredAt = +L.one(`SELECT retired_at FROM qwen_output_session_retirement WHERE session_id='${M.session}'`) - t0; } catch {}
  const completed = +L.one(`SELECT completed_at FROM managed_agent_operation WHERE session_id='${M.session}' AND operation_kind='DELETE'`) - t0;
  event = { name: 'deleted', insertedAt, seenDeletedAt: done?.at, bytesAtEvent: done?.bytes ?? progress.bytes, at: retiredAt ?? completed, retiredAt, opCompletedAt: completed };
}
const r = await dl;
await L.throttle(0);
const gets = (await L.ossLedger()).filter((e) => e.t >= t0 && e.method === 'GET');
const starts = gets.map((e) => e.t - t0);
const res = { arm: ARM, mode: MODE, readTimeout: process.env.READ_TIMEOUT ?? '2m', size: a.byte_length, status: r.status, declared: r.declared, received: r.bytes, ended: r.ended, lastByteMs: r.lastByteMs, closeMs: r.closeMs, shaOk: r.sha256 === a.sha256, ossGets: gets.length, lastGetStartMs: Math.max(...starts), event, getsAfterEvent: event ? starts.filter((s) => s > event.at).length : null, timeline: r.timeline };
if (event) res.bytesAfterEvent = r.bytes - event.bytesAtEvent;
const after = await L.content(M.session, a.id, { revision: a.revision, range: 'bytes=0-99' });
res.afterwards = `${after.status}${after.code ? '/' + after.code : ''}`;
res.leaseRows = (() => { try { return +L.one(`SELECT COUNT(*) FROM qwen_output_read_lease`); } catch { return 'n/a'; } })();
L.say('result', res);
L.out(`s3-${ARM}-${MODE}${process.env.SUFFIX ?? ''}.json`, res);
