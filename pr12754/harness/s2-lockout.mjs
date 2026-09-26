// A Session whose cwd_relative does not exist (or stops existing) at
// acquisition: the SQL holder is claimed before the worker refuses the
// context installation, and the refusal retains it.
import * as L from './lib.mjs';
import fs from 'node:fs';

const arm = process.argv[2] ?? 'pr';
const db = `rig_lockout_${arm}`;
const A = `${L.RIG}/roots/lock-${arm}-a`;
fs.rmSync(A, { recursive: true, force: true });
fs.mkdirSync(`${A}/docs`, { recursive: true });
const short = (s) => String(s).replaceAll(A, '<rootA>').replaceAll(L.RIG, '<rig>');
const say = (t, s) => L.say(t, short(s));
L.openLog(`s2-lockout-${arm}`);
try { L.sql('mysql', `DROP DATABASE IF EXISTS ${db}`); } catch {}
const mounts = [
  '--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=t-alpha',
  '--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=st-a',
  `--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=${A}`,
];
const J = { http: 18771, broker: 19771, name: `lock-${arm}-jvm1` };
L.startServer(arm, J.name, J.http, J.broker, db, mounts);
await L.waitHealth(J.http);
L.seedRegistry(db, 't-alpha', 'ws-a', 'st-a', { actors: ['alice', 'bob'] });
const H = () => JSON.stringify(L.holders(db));
const mk = async (actor, cwd) => {
  const r = await L.createSession(J.http, 't-alpha', actor, 'ws-a', cwd);
  say('create', `${actor} cwd=${cwd}: ${r.status}`);
  return r.json.id;
};

say('A', '--- variant 1: Session created with a directory that does not exist ---');
const alice = await mk('alice', 'docs');
const ghost = await mk('bob', 'not-yet-created');
say('A', `ghost acquire g-rt1: ${L.brief(await L.acquire(J.broker, ghost, 'g-rt1'))}`);
say('A', `holders: ${H()}`);
say('A', `alice acquire a-rt1 (same storage, healthy Session): ${L.brief(await L.acquire(J.broker, alice, 'a-rt1'))}`);
say('A', `ghost release g-rt1: ${L.brief(await L.release(J.broker, ghost, 'g-rt1'))}`);
say('A', `ghost retry g-rt1: ${L.brief(await L.acquire(J.broker, ghost, 'g-rt1'))}`);
say('A', `runtime session rows: ${JSON.stringify(L.sql(db, "SELECT runtime_session_id, session_state FROM qwen_runtime_session ORDER BY runtime_session_id"))}`);
say('A', 'waiting 65 s (> 2x the 30 s Broker lease) ...');
await L.sleep(65000);
say('A', `alice acquire a-rt2 after 65 s: ${L.brief(await L.acquire(J.broker, alice, 'a-rt2'))}`);
say('A', `holders: ${H()}`);

say('C', '--- the only in-band exit: make the directory exist and retry the SAME runtime id ---');
fs.mkdirSync(`${A}/not-yet-created`);
say('C', `mkdir <rootA>/not-yet-created; ghost retry g-rt1: ${L.brief(await L.acquire(J.broker, ghost, 'g-rt1'))}`);
say('C', `ghost release g-rt1: ${L.brief(await L.release(J.broker, ghost, 'g-rt1'))}`);
say('C', `alice acquire a-rt4: ${L.brief(await L.acquire(J.broker, alice, 'a-rt4'))}`);
say('C', `holders: ${H()}`);

say('D', '--- variant 2: another Session deletes the directory with an ordinary Shell call ---');
const carol = await mk('bob', 'docs');
say('D', `alice (current holder, cwd=docs) runs an ordinary Shell call: ${L.outcome(await L.run(J.broker, alice, 'a-rt4', 'run_shell_command', { command: 'cd .. && rm -rf docs && ls', is_background: false }))}`);
say('D', `alice release a-rt4: ${L.brief(await L.release(J.broker, alice, 'a-rt4'))}`);
say('D', `holders after a clean release: ${H()}`);
say('D', `bob's Session (cwd=docs) acquire c-rt1: ${L.brief(await L.acquire(J.broker, carol, 'c-rt1'))}`);
const other = await mk('alice', '.');
say('D', `a fresh root-level Session acquire o-rt1: ${L.brief(await L.acquire(J.broker, other, 'o-rt1'))}`);
say('D', `holders: ${H()}`);
say('B', '--- restart the server: ownership is durable ---');
L.stopServer(J.name);
await L.sleep(6000);
L.startServer(arm, J.name, J.http, J.broker, db, mounts);
await L.waitHealth(J.http);
const fresh = await mk('alice', '.');
say('B', `a Session created after the restart acquire f-rt1: ${L.brief(await L.acquire(J.broker, fresh, 'f-rt1'))}`);
say('B', `holders: ${H()}`);
say('D', `worker launches: ${L.launches(J.name).length}; live workers: ${L.workerPids().length}`);
L.stopServer(J.name);
await L.sleep(5000);
