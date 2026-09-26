// Main behaviour matrix: two JVMs (separate Spring servers + embedded Brokers)
// sharing one real MySQL 8.4.7 database, real workers, two storage roots.
import * as L from './lib.mjs';
import fs from 'node:fs';

const arm = process.argv[2] ?? 'pr';
const db = `rig_matrix_${arm}`;
const A = `${L.RIG}/roots/${arm}-a`;
const B = `${L.RIG}/roots/${arm}-b`;
fs.rmSync(A, { recursive: true, force: true });
fs.rmSync(B, { recursive: true, force: true });
fs.mkdirSync(`${A}/child/nested`, { recursive: true });
fs.mkdirSync(B, { recursive: true });
fs.writeFileSync(`${A}/root-note.txt`, 'root note\n');
const short = (s) => String(s).replaceAll(A, '<rootA>').replaceAll(B, '<rootB>').replaceAll(L.RIG, '<rig>');
const say = (t, s) => L.say(t, short(s));
L.openLog(`s1-matrix-${arm}`);
try { L.sql('mysql', `DROP DATABASE IF EXISTS ${db}`); } catch {}

const mounts = [
  '--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=t-alpha',
  '--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=st-a',
  `--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=${A}`,
  '--qwen.managed-agent.runtime-broker.workspace-mounts[1].tenant-id=t-alpha',
  '--qwen.managed-agent.runtime-broker.workspace-mounts[1].storage-id=st-b',
  `--qwen.managed-agent.runtime-broker.workspace-mounts[1].root=${B}`,
];
const J1 = { http: 18761, broker: 19761, name: `${arm}-jvm1` };
const J2 = { http: 18762, broker: 19762, name: `${arm}-jvm2` };
L.startServer(arm, J1.name, J1.http, J1.broker, db, mounts);
await L.waitHealth(J1.http);
L.startServer(arm, J2.name, J2.http, J2.broker, db, mounts);
await L.waitHealth(J2.http);
say('setup', `two JVMs up (pids ${fs.readFileSync(`${L.RIG}/run/${J1.name}.pid`, 'utf8')} / ${fs.readFileSync(`${L.RIG}/run/${J2.name}.pid`, 'utf8')}), MySQL db ${db}`);
say('setup', `flyway: ${JSON.stringify(L.sql(db, 'SELECT version, success FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 1'))}`);

L.seedRegistry(db, 't-alpha', 'ws-a', 'st-a');
L.seedRegistry(db, 't-alpha', 'ws-b', 'st-b');
const mk = async (ws, cwd) => {
  const r = await L.createSession(J1.http, 't-alpha', 'alice', ws, cwd);
  if (r.status !== 202) throw new Error('create ' + L.brief(r));
  return r.json.id;
};
const S1 = await mk('ws-a', 'child');
const S2 = await mk('ws-a', '.');
const S3 = await mk('ws-b', '.');
const S4 = await mk('ws-a', 'child/nested');
say('setup', `S1=ws-a:child S2=ws-a:. S3=ws-b:. S4=ws-a:child/nested (all created via public W0b API as actor alice)`);
const H = () => JSON.stringify(L.holders(db));

say('1', '--- real tools in two roots / child directories (JVM1: S1, S3) ---');
say('1', `S1 acquire @JVM1: ${L.brief(await L.acquire(J1.broker, S1, 's1-rt1'))}`);
say('1', `S1 write_file child/f.txt: ${L.outcome(await L.run(J1.broker, S1, 's1-rt1', 'write_file', { file_path: `${A}/child/f.txt`, content: 'alpha\n' }))}`);
say('1', `S1 read_file: ${L.outcome(await L.run(J1.broker, S1, 's1-rt1', 'read_file', { file_path: `${A}/child/f.txt` }))}`);
say('1', `S1 edit alpha->beta: ${L.outcome(await L.run(J1.broker, S1, 's1-rt1', 'edit', { file_path: `${A}/child/f.txt`, old_string: 'alpha', new_string: 'beta' }))}`);
say('1', `S1 shell pwd+cat: ${L.outcome(await L.run(J1.broker, S1, 's1-rt1', 'run_shell_command', { command: 'pwd; cat f.txt', is_background: false }))}`);
say('1', `S1 read_file <rootA>/root-note.txt (mount root, outside child): ${L.outcome(await L.run(J1.broker, S1, 's1-rt1', 'read_file', { file_path: `${A}/root-note.txt` }))}`);
say('1', `S1 shell with directory=<rootA> (mount root): ${L.outcome(await L.run(J1.broker, S1, 's1-rt1', 'run_shell_command', { command: 'pwd', directory: A, is_background: false }))}`);
say('1', `S1 write_file OUTSIDE the mount (<rig>/roots/outside-${arm}.txt): ${L.outcome(await L.run(J1.broker, S1, 's1-rt1', 'write_file', { file_path: `${L.RIG}/roots/outside-${arm}.txt`, content: 'written by S1\n' }))}`);
say('1', `  -> on disk: ${JSON.stringify(fs.existsSync(`${L.RIG}/roots/outside-${arm}.txt`) ? fs.readFileSync(`${L.RIG}/roots/outside-${arm}.txt`, 'utf8') : null)}`);
say('1', `S1 read_file OUTSIDE the mount (/etc/hosts): ${L.outcome(await L.run(J1.broker, S1, 's1-rt1', 'read_file', { file_path: '/etc/hosts', limit: 1 }))}`);
say('1', `S3 acquire @JVM1 (other storage, concurrently): ${L.brief(await L.acquire(J1.broker, S3, 's3-rt1'))}`);
say('1', `S3 shell: ${L.outcome(await L.run(J1.broker, S3, 's3-rt1', 'run_shell_command', { command: 'pwd; echo b > b.txt; ls', is_background: false }))}`);
say('1', `disk: <rootA>/child/f.txt=${JSON.stringify(fs.readFileSync(`${A}/child/f.txt`, 'utf8'))} <rootB>/b.txt=${JSON.stringify(fs.readFileSync(`${B}/b.txt`, 'utf8'))}`);
say('1', `holders: ${H()}`);

say('2', '--- same-storage contention across JVMs (JVM2: S2, S4) ---');
say('2', `S2 acquire @JVM2 while S1 holds st-a on JVM1: ${L.brief(await L.acquire(J2.broker, S2, 's2-rt1'))}`);
say('2', `S4 acquire @JVM2: ${L.brief(await L.acquire(J2.broker, S4, 's4-rt1'))}`);
say('2', `holders: ${H()}`);

say('3', '--- release while a foreground Shell call is running ---');
const slow = await L.start(J1.broker, S1, 's1-rt1', 'run_shell_command', { command: 'node -e "setTimeout(()=>{},4000)" && echo slow > slow.txt', is_background: false });
say('3', `start slow shell: ${L.brief(slow.created).slice(0, 60)}… state=${slow.created.json?.status?.state}`);
await L.sleep(800);
say('3', `release S1 during the call: ${L.brief(await L.release(J1.broker, S1, 's1-rt1'))}`);
say('3', `holders: ${H()}`);
say('3', `slow call settles: ${L.outcome({ final: await L.poll(J1.broker, S1, 's1-rt1', slow.id) })}`);
say('3', `release S1 after settlement: ${L.brief(await L.release(J1.broker, S1, 's1-rt1'))}`);
say('3', `holders: ${H()}`);

say('4', '--- cross-JVM hand-off and stale release ---');
say('4', `S2 retries the same runtime id s2-rt1 @JVM2: ${L.brief(await L.acquire(J2.broker, S2, 's2-rt1'))}`);
say('4', `S2 write <rootA>/from-s2.txt @JVM2: ${L.outcome(await L.run(J2.broker, S2, 's2-rt1', 'write_file', { file_path: `${A}/from-s2.txt`, content: 'jvm2\n' }))}`);
say('4', `stale release of S1/s1-rt1 again @JVM1: ${L.brief(await L.release(J1.broker, S1, 's1-rt1'))}`);
say('4', `holders (S2 must remain): ${H()}`);
say('4', `S2 still executes: ${L.outcome(await L.run(J2.broker, S2, 's2-rt1', 'run_shell_command', { command: 'ls', is_background: false }))}`);
say('4', `S1 acquire (new id s1-rt2) @JVM1 while S2 holds: ${L.brief(await L.acquire(J1.broker, S1, 's1-rt2'))}`);
say('4', `release S2 @JVM2: ${L.brief(await L.release(J2.broker, S2, 's2-rt1'))}`);
say('4', `holders: ${H()}`);

say('5', '--- frozen references vs Registry changes ---');
L.sql(db, "UPDATE managed_workspace_registry SET config_ref='later-config/2', policy_ref='later-policy/2' WHERE workspace_id='ws-a'");
say('5', 'Registry ws-a config/policy changed to later-config/2 + later-policy/2');
say('5', `S4 (created before) retries s4-rt1 @JVM2: ${L.brief(await L.acquire(J2.broker, S4, 's4-rt1'))}`);
say('5', `S4 shell: ${L.outcome(await L.run(J2.broker, S4, 's4-rt1', 'run_shell_command', { command: 'pwd', is_background: false }))}`);
say('5', `release S4: ${L.brief(await L.release(J2.broker, S4, 's4-rt1'))}`);
const S5 = await mk('ws-a', '.');
say('5', `S5 created after the change, saved refs: ${JSON.stringify(L.sql(db, `SELECT workspace_config_ref, workspace_policy_ref FROM managed_agent_session WHERE session_id='${S5}'`))}`);
say('5', `S5 acquire @JVM1: ${L.brief(await L.acquire(J1.broker, S5, 's5-rt1'))}`);
say('5', `holders (S5 must not hold): ${H()}`);
L.sql(db, "UPDATE managed_workspace_registry SET config_ref='managed-runtime-tools/1', policy_ref='preapproved-workspace-tools/1' WHERE workspace_id='ws-a'");

say('6', '--- revoke the creator grant after acquisition ---');
say('6', `S4 acquire s4-rt2 @JVM2: ${L.brief(await L.acquire(J2.broker, S4, 's4-rt2'))}`);
L.sql(db, "UPDATE managed_workspace_access SET can_read=FALSE WHERE workspace_id='ws-a'");
say('6', 'revoked alice can_read on ws-a');
const rev = await L.run(J2.broker, S4, 's4-rt2', 'write_file', { file_path: `${A}/child/nested/revoked.txt`, content: 'must not exist' });
say('6', `S4 write after revoke: http=${rev.created.status} ${L.outcome(rev)}`);
say('6', `revoked.txt exists: ${fs.existsSync(`${A}/child/nested/revoked.txt`)}`);
say('6', `release S4: ${L.brief(await L.release(J2.broker, S4, 's4-rt2'))}`);
say('6', `holders: ${H()}`);
L.sql(db, "UPDATE managed_workspace_access SET can_read=TRUE WHERE workspace_id='ws-a'");

say('7', '--- delete the Session through the public API while it holds storage ---');
say('7', `S2 acquire s2-rt2 @JVM2: ${L.brief(await L.acquire(J2.broker, S2, 's2-rt2'))}`);
const del = await L.api(J2.http, 'DELETE', `/v1/agents/sessions/${S2}`, { tenant: 't-alpha', actor: 'alice', idem: 'del-' + S2 });
say('7', `DELETE S2: ${L.brief(del)}`);
say('7', `S2 row: ${JSON.stringify(L.sql(db, `SELECT status, deleted_at IS NOT NULL, workspace_storage_id FROM managed_agent_session WHERE session_id='${S2}'`))}`);
const afterDel = await L.run(J2.broker, S2, 's2-rt2', 'write_file', { file_path: `${A}/after-delete.txt`, content: 'x' });
say('7', `S2 write after delete: ${L.outcome(afterDel)}`);
say('7', `after-delete.txt exists: ${fs.existsSync(`${A}/after-delete.txt`)}`);
say('7', `release S2: ${L.brief(await L.release(J2.broker, S2, 's2-rt2'))}`);
say('7', `holders: ${H()}`);

say('8', '--- original call status/cancel after revocation ---');
const long = await L.start(J1.broker, S3, 's3-rt1', 'run_shell_command', { command: 'node -e "setTimeout(()=>{},20000)"', is_background: false });
await L.sleep(800);
L.sql(db, "UPDATE managed_workspace_access SET can_read=FALSE WHERE workspace_id='ws-b'");
const st = await L.broker(J1.broker, 'GET', `/executions/${long.id}?requestId=r1&harnessSessionId=${S3}&runtimeSessionId=s3-rt1`);
say('8', `status after revoke: ${st.status} state=${st.json?.status?.state}`);
const cancel = await L.broker(J1.broker, 'POST', `/executions/${long.id}:cancel`, { harnessSessionId: S3, runtimeSessionId: 's3-rt1' });
say('8', `cancel after revoke: ${cancel.status} state=${cancel.json?.status?.state}`);
say('8', `settles: ${L.outcome({ final: await L.poll(J1.broker, S3, 's3-rt1', long.id) })}`);
say('8', `release S3: ${L.brief(await L.release(J1.broker, S3, 's3-rt1'))}`);
say('8', `holders: ${H()}`);

say('9', `worker launches JVM1=${L.launches(J1.name).length} JVM2=${L.launches(J2.name).length}; live workers before shutdown: ${L.workerPids().length}`);
L.stopServer(J1.name);
L.stopServer(J2.name);
await L.sleep(6000);
say('9', `live workers after shutdown: ${L.workerPids().length}`);
