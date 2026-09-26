// Before/after: the same real MySQL + worker setup against the base jar
// (#12730 head 5e443797, = main for these files) and the PR jar. Also runs the
// unchanged legacy (unbound) path on both.
import * as L from './lib.mjs';
import fs from 'node:fs';

const arm = process.argv[2] ?? 'pr';
const db = `rig_ab_${arm}`;
const A = `${L.RIG}/roots/ab-${arm}-a`;
const LEG = `${L.RIG}/legacy-ws`;
fs.rmSync(A, { recursive: true, force: true });
fs.mkdirSync(A, { recursive: true });
const short = (s) => String(s).replaceAll(A, '<rootA>').replaceAll(LEG, '<legacy-ws>').replaceAll(L.RIG, '<rig>');
const say = (t, s) => L.say(t, short(s));
L.openLog(`s3-ab-${arm}`);
try { L.sql('mysql', `DROP DATABASE IF EXISTS ${db}`); } catch {}
const J = { http: 18781, broker: 19781, name: `ab-${arm}` };
L.startServer(arm, J.name, J.http, J.broker, db, [
  '--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=t-alpha',
  '--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=st-a',
  `--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=${A}`,
]);
await L.waitHealth(J.http);
say('setup', `arm=${arm} flyway head=${JSON.stringify(L.sql(db, 'SELECT MAX(CAST(version AS UNSIGNED)) FROM flyway_schema_history'))}`);
say('setup', `binding slot columns: ${JSON.stringify(L.sql(db, "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='qwen_runtime_binding_slot' AND column_name IN ('placement_domain','runtime_template_digest') ORDER BY column_name"))}`);
L.seedRegistry(db, 't-alpha', 'ws-a', 'st-a');

const leg = await L.createLegacySession(J.http, 't-alpha');
say('legacy', `create unbound Session: ${leg.status}`);
say('legacy', `acquire: ${L.brief(await L.acquire(J.broker, leg.json.id, 'leg-rt1'))}`);
say('legacy', `shell pwd: ${L.outcome(await L.run(J.broker, leg.json.id, 'leg-rt1', 'run_shell_command', { command: 'pwd', is_background: false }))}`);
say('legacy', `write_file outside <legacy-ws>: ${L.outcome(await L.run(J.broker, leg.json.id, 'leg-rt1', 'write_file', { file_path: `${L.RIG}/roots/legacy-outside-${arm}.txt`, content: 'legacy\n' }))}`);
say('legacy', `release: ${L.brief(await L.release(J.broker, leg.json.id, 'leg-rt1'))}`);

const bound = await L.createSession(J.http, 't-alpha', 'alice', 'ws-a', '.');
say('bound', `create W0b Session: ${bound.status}`);
say('bound', `acquire: ${L.brief(await L.acquire(J.broker, bound.json.id, 'b-rt1'))}`);
say('bound', `shell pwd: ${L.outcome(await L.run(J.broker, bound.json.id, 'b-rt1', 'run_shell_command', { command: 'pwd', is_background: false }))}`);
say('bound', `release: ${L.brief(await L.release(J.broker, bound.json.id, 'b-rt1'))}`);
say('bound', `holders: ${JSON.stringify(L.holders(db))}`);
say('end', `worker launches: ${L.launches(J.name).length}`);
L.stopServer(J.name);
await L.sleep(5000);
