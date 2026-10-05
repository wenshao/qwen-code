// VERIFICATION RIG ONLY (PR #13354): ordinary-path cost of the L3 fence. One tenant, N concurrent Workspace Sessions
// (4 Workspaces / storages c..f), each running one multi-tool Turn (write -> edit -> read = 4 model calls, 3 tools).
// Measures per-round wall time, per-Turn latency, and MySQL global-status deltas (row-lock waits/time, statements).
// usage: DB=.. ARM=.. node p8-contention.mjs <sessionsPerRound> <rounds>
import * as L from './lib.mjs';
const N = Number(process.argv[2] ?? 8), ROUNDS = Number(process.argv[3] ?? 3);
const R = new L.Report(`p8-contention-${N}x${ROUNDS}`);
const WS = [['ws-c', 'st-c'], ['ws-d', 'st-d'], ['ws-e', 'st-e'], ['ws-f', 'st-f']];
for (const [w, s] of WS) await L.ensureWorkspace(w, s);
const status = async () => Object.fromEntries((await L.sql("SHOW GLOBAL STATUS WHERE Variable_name IN ('Innodb_row_lock_waits','Innodb_row_lock_time','Com_select','Com_update','Com_insert','Com_delete','Questions','Innodb_deadlocks')")).map((r) => [r.Variable_name, Number(r.Value)]));
// warm-up: one Session per Workspace (first worker spawn per storage is not what we measure)
const warm = await Promise.all(WS.map(([w]) => L.createSession('public', w, `G_WRITE name=warm-${Date.now().toString(36)}.txt content=w`)));
await Promise.all(warm.map((c) => L.waitTurns(c.session, 1, 120_000)));
const rounds = [];
for (let r = 0; r < ROUNDS; r++) {
  const s0 = await status();
  const t0 = Date.now();
  const created = await Promise.all(Array.from({ length: N }, (_, i) => L.createSession('public', WS[i % WS.length][0], `G_FILES name=c${r}-${i}-${Date.now().toString(36)}.txt tag=r${r}i${i}`)));
  const done = await Promise.all(created.map(async (c) => { const a = Date.now(); const t = await L.waitTurns(c.session, 1, 300_000); return { ms: Date.now() - a, status: t.rows.at(-1)?.status, err: t.rows.at(-1)?.err }; }));
  const wall = Date.now() - t0;
  const s1 = await status();
  const delta = Object.fromEntries(Object.keys(s1).map((k) => [k, s1[k] - s0[k]]));
  const lat = done.map((d) => d.ms).sort((a, b) => a - b);
  rounds.push({ round: r, wall, p50: lat[Math.floor(lat.length / 2)], max: lat.at(-1), completed: done.filter((d) => d.status === 'COMPLETED').length, failed: done.filter((d) => d.status !== 'COMPLETED').map((d) => `${d.status}:${d.err}`), ...delta });
  R.note(`round ${r}`, rounds.at(-1));
}
const sum = (k) => rounds.reduce((a, x) => a + x[k], 0);
R.check(`all ${N * ROUNDS} Turns completed`, sum('completed') === N * ROUNDS, rounds.map((x) => x.failed));
R.note('per-Turn averages', { questions: Math.round(sum('Questions') / (N * ROUNDS)), selects: Math.round(sum('Com_select') / (N * ROUNDS)), updates: Math.round(sum('Com_update') / (N * ROUNDS)), inserts: Math.round(sum('Com_insert') / (N * ROUNDS)), rowLockWaits: sum('Innodb_row_lock_waits'), rowLockTimeMs: sum('Innodb_row_lock_time'), deadlocks: sum('Innodb_deadlocks'), wallMs: rounds.map((x) => x.wall), p50: rounds.map((x) => x.p50), max: rounds.map((x) => x.max) });
R.done({ rounds, N, ROUNDS });
await L.closeDb();
