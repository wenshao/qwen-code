// Symmetric A/B of both lockout variants (PR vs candidate), same steps.
import * as L from './lib.mjs';
import fs from 'node:fs';

const arm = process.argv[2] ?? 'h2';
const db = `rig_lockab_${arm}`;
const A = `${L.RIG}/roots/lockab-${arm}-a`;
fs.rmSync(A, { recursive: true, force: true });
const B = `${L.RIG}/roots/lockab-${arm}-b`;
fs.rmSync(B, { recursive: true, force: true });
fs.mkdirSync(A, { recursive: true });
fs.mkdirSync(`${B}/docs`, { recursive: true });
L.openLog(`s2b-ab-${arm}`);
const say = (t, s) => L.say(t, String(s).replaceAll(A, '<rootA>').replaceAll(B, '<rootB>'));
try { L.sql('mysql', `DROP DATABASE IF EXISTS ${db}`); } catch {}
const J = { http: 18821, broker: 19821, name: `lockab-${arm}` };
L.startServer(arm, J.name, J.http, J.broker, db, [
  '--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=t-alpha',
  '--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=st-a',
  `--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=${A}`,
  '--qwen.managed-agent.runtime-broker.workspace-mounts[1].tenant-id=t-alpha',
  '--qwen.managed-agent.runtime-broker.workspace-mounts[1].storage-id=st-b',
  `--qwen.managed-agent.runtime-broker.workspace-mounts[1].root=${B}`,
]);
await L.waitHealth(J.http);
L.seedRegistry(db, 't-alpha', 'ws-a', 'st-a', { actors: ['alice', 'bob'] });
L.seedRegistry(db, 't-alpha', 'ws-b', 'st-b', { actors: ['alice', 'bob'] });
const mk = async (actor, cwd, ws = 'ws-a') => (await L.createSession(J.http, 't-alpha', actor, ws, cwd)).json.id;
const H = () => JSON.stringify(L.holders(db).map((h) => h[1]));
const alice = await mk('alice', 'docs', 'ws-b');
const bob = await mk('bob', 'docs', 'ws-b');
const otherB = await mk('alice', '.', 'ws-b');
const ghost = await mk('bob', 'typo-dir');
const other = await mk('alice', '.');
say(arm, `[1] bob creates a Session with cwd_relative=typo-dir (no such directory) -> 202; acquire: ${L.brief(await L.acquire(J.broker, ghost, 'g1'))}`);
say(arm, `    SQL holder: ${H()}; alice's healthy Session acquire: ${L.brief(await L.acquire(J.broker, other, 'o1'))}`);
await L.release(J.broker, other, 'o1');
say(arm, `[2] (second storage) alice (cwd=docs) acquire: ${L.brief(await L.acquire(J.broker, alice, 'a1')).slice(0, 18)}; runs "cd .. && rm -rf docs": ${L.outcome(await L.run(J.broker, alice, 'a1', 'run_shell_command', { command: 'cd .. && rm -rf docs', is_background: false })).slice(0, 38)}; release: ${L.brief(await L.release(J.broker, alice, 'a1')).slice(0, 3)}`);
say(arm, `    bob's Session (cwd=docs) acquire: ${L.brief(await L.acquire(J.broker, bob, 'b1'))}`);
say(arm, `    SQL holders: ${H()}; alice's root-level Session on the same storage acquire: ${L.brief(await L.acquire(J.broker, otherB, 'ob1'))}`);
L.stopServer(J.name);
await L.sleep(5000);
