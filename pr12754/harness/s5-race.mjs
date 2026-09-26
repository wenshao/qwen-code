// Concurrent acquisition race on one storage across two JVMs sharing real
// MySQL: every round fires all acquires at once; exactly one may win.
import * as L from './lib.mjs';
import fs from 'node:fs';

const arm = process.argv[2] ?? 'pr';
const PER_JVM = Number(process.argv[3] ?? 4);
const ROUNDS = Number(process.argv[4] ?? 5);
const db = `rig_race_${arm}`;
const A = `${L.RIG}/roots/race-${arm}-a`;
fs.rmSync(A, { recursive: true, force: true });
fs.mkdirSync(A, { recursive: true });
L.openLog(`s5-race-${arm}`);
try { L.sql('mysql', `DROP DATABASE IF EXISTS ${db}`); } catch {}
const mounts = [
  '--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=t-alpha',
  '--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=st-a',
  `--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=${A}`,
];
const J1 = { http: 18801, broker: 19801, name: `race-${arm}-1` };
const J2 = { http: 18802, broker: 19802, name: `race-${arm}-2` };
L.startServer(arm, J1.name, J1.http, J1.broker, db, mounts);
await L.waitHealth(J1.http);
L.startServer(arm, J2.name, J2.http, J2.broker, db, mounts);
await L.waitHealth(J2.http);
L.seedRegistry(db, 't-alpha', 'ws-a', 'st-a');
const sessions = [];
for (let i = 0; i < PER_JVM * 2; i++) {
  const r = await L.createSession(J1.http, 't-alpha', 'alice', 'ws-a', '.');
  sessions.push({ id: r.json.id, jvm: i % 2 === 0 ? J1 : J2, n: i });
}
// Warm each Session's worker first so every round races only on the SQL claim.
await Promise.all(sessions.map((s) => L.broker(s.jvm.broker, 'POST', '/tool-sessions:acquire', { harnessSessionId: s.id, runtimeSessionId: `warm-${s.n}`, turnKind: 'bootstrap' })));
for (const s of sessions) await L.release(s.jvm.broker, s.id, `warm-${s.n}`);
L.say('setup', `${sessions.length} Sessions on one storage, alternating between 2 JVMs; holders after warm-up: ${JSON.stringify(L.holders(db))}`);
const tally = { won: 0, busy: 0, other: 0 };
for (let round = 1; round <= ROUNDS; round++) {
  const results = await Promise.all(sessions.map((s) => L.acquire(s.jvm.broker, s.id, `r${round}-s${s.n}`).then((r) => ({ s, r }))));
  const won = results.filter((x) => x.r.status === 200);
  const busy = results.filter((x) => x.r.json?.code === 'workspace_busy');
  const other = results.filter((x) => x.r.status !== 200 && x.r.json?.code !== 'workspace_busy');
  tally.won += won.length; tally.busy += busy.length; tally.other += other.length;
  const holder = L.holders(db).map((h) => h[1]).join(',');
  L.say(`round ${round}`, `won=${won.length} (${won.map((x) => `s${x.s.n}@${x.s.jvm === J1 ? 'JVM1' : 'JVM2'}`).join(',')}) busy=${busy.length} other=${other.length}${other.length ? ' ' + other.map((x) => L.brief(x.r)).join(' | ') : ''} sqlHolder=${holder}`);
  for (const x of won) {
    const w = await L.run(x.s.jvm.broker, x.s.id, `r${round}-s${x.s.n}`, 'run_shell_command', { command: `echo r${round} >> rounds.txt`, is_background: false });
    L.say(`round ${round}`, `winner writes: ${L.outcome(w).slice(0, 60)}; release: ${L.brief(await L.release(x.s.jvm.broker, x.s.id, `r${round}-s${x.s.n}`)).slice(0, 40)}`);
  }
}
L.say('total', `${JSON.stringify(tally)}; rounds.txt=${JSON.stringify(fs.readFileSync(`${A}/rounds.txt`, 'utf8'))}; final holders=${JSON.stringify(L.holders(db))}`);
L.say('total', `MySQL deadlocks counter: ${JSON.stringify(L.sql(db, "SHOW GLOBAL STATUS LIKE 'Innodb_deadlocks'"))}`);
L.stopServer(J1.name);
L.stopServer(J2.name);
await L.sleep(6000);
L.say('total', `live workers after shutdown: ${L.workerPids().length}`);
