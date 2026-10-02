// F2 (PR #13225): SQL cost and the fixed 120 s read lease for public artifact downloads, base vs PR arm.
// One Workspace Session per arm produces SO bytes of stdout; the public full download is measured
// (a) at local DB latency: statements per MiB (SHOW GLOBAL STATUS Questions, idle rate subtracted) and a
//     general_log breakdown, (b) with +DELAY ms per client->server DB packet: does the response finish?
import fs from 'node:fs';
import * as L from './lib.mjs';
const ARM = process.env.ARM, SO = Number(process.env.SO ?? 40 * 1024 * 1024 + 7), DELAYS = (process.env.DELAYS ?? '5').split(',').map(Number);
const CTL = '/Users/wenshao/pr13225-rig/run/db-delay-ms';
const TAG = process.env.TAG ?? `f2-${ARM}-${Date.now().toString(36)}`;
L.openLog(TAG);
const setDelay = async (ms) => { fs.writeFileSync(CTL, String(ms)); await L.sleep(600); };
await setDelay(0);
const ws = `ws-${TAG}`; L.register(ws, process.env.ST ?? 'st-s30');
const t0 = Date.now();
const S = await L.createShellSession(ws, L.shellPrompt('f2', L.genCmd(TAG, SO, 0, 0)), { key: `k-${TAG}` });
const turn = await L.waitTurn(S, { timeoutMs: 900_000 }); await L.waitProjection(S, { timeoutMs: 600_000 });
const a = (await L.artifacts(S)).list.find((x) => x.stream_role === 'stdout');
const want = L.genSha(TAG, 'stdout', SO);
L.say('made', { arm: ARM, session: S, turn: turn.status, artifact: a.byte_length, ossObjects: +L.one(`SELECT COUNT(*) FROM qwen_tool_publication_object o JOIN qwen_tool_publication p USING (scope_key, publication_id) WHERE p.session_id='${S}' AND o.object_key IS NOT NULL`), ms: Date.now() - t0 });
const q = () => Number(L.sql("SHOW GLOBAL STATUS LIKE 'Questions'", 'mysql')[0][1]);
async function measure(fn) {
  const q0 = q(); const s0 = Date.now(); const r = await fn(); const ms = Date.now() - s0; const q1 = q();
  await L.sleep(Math.min(ms, 20_000)); const q2 = q();
  const idle = (q2 - q1) * ms / Math.min(ms, 20_000);
  return { ...r, ms, questions: q1 - q0, idleAdjusted: Math.round(q1 - q0 - idle) };
}
const mib = a.byte_length / 1048576;
const full = await measure(async () => { const r = await L.streamDownload(S, a); return { status: r.status, bytes: r.bytes, ended: r.ended, shaOk: r.sha256 === want }; });
full.perMiB = +(full.idleAdjusted / mib).toFixed(1);
L.say('full@0ms', full);
const rng = await measure(async () => { const r = await L.content(S, a.id, { revision: a.revision, range: `bytes=${8 * 1048576}-${9 * 1048576 - 1}` }); return { status: r.status, bytes: r.body.length }; });
L.say('range-1MiB@0ms', rng);
// general_log breakdown of one full download
L.sql("SET GLOBAL log_output='TABLE'; SET GLOBAL general_log='OFF'; TRUNCATE TABLE mysql.general_log; SET GLOBAL general_log='ON'", 'mysql');
const d = await L.streamDownload(S, a);
L.sql("SET GLOBAL general_log='OFF'", 'mysql');
const norm = (s) => s.replace(/^[\x00-\x20]+/, '').replace(/'(?:[^'\\]|\\.)*'/g, '?').replace(/\b\d+\b/g, '?').replace(/\s+/g, ' ').replace(/\(\?(?:, ?\?)+\)/g, '(?..)').slice(0, 110);
const rows = L.sql("SELECT REPLACE(REPLACE(CONVERT(argument USING utf8mb4), '\\n', ' '), '\\t', ' ') FROM mysql.general_log WHERE command_type IN ('Query','Execute') AND argument NOT LIKE '%general_log%' AND argument NOT LIKE 'SHOW GLOBAL%'", 'mysql').map((r) => norm(r[0]));
const m = new Map(); for (const r of rows) m.set(r, (m.get(r) ?? 0) + 1);
L.say('breakdown', { status: d.status, shaOk: d.sha256 === want, total: rows.length, perMiB: +(rows.length / mib).toFixed(1), top: [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => `${v} ${k}`) });
for (const ms of DELAYS) {
  await setDelay(ms);
  const r = await L.streamDownload(S, a);
  L.say(`full@${ms}ms`, { status: r.status, bytes: r.bytes, MiB: +(r.bytes / 1048576).toFixed(1), of: +mib.toFixed(1), ended: r.ended, shaOk: r.sha256 === want, closeMs: r.closeMs, lastByteMs: r.lastByteMs, timeline: r.timeline.filter((_, i) => i % 3 === 0).map(([t, b]) => `${Math.round(t / 1000)}s:${(b / 1048576).toFixed(1)}MiB`) });
}
await setDelay(0);
L.out(`${TAG}.json`, { ARM, S, full, rng });
