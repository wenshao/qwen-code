// Deleted / rebound Session rows while the Runtime Session holds storage
// (the public DELETE of a bound Session is still gated, so edit the row).
import * as L from './lib.mjs';
import fs from 'node:fs';

const arm = process.argv[2] ?? 'h2';
const db = `rig_snapshot_${arm}`;
const A = `${L.RIG}/roots/snap-${arm}-a`;
fs.rmSync(A, { recursive: true, force: true });
fs.mkdirSync(A, { recursive: true });
L.openLog(`s6-stale-snapshot-${arm}`);
const say = (t, s) => L.say(t, String(s).replaceAll(A, '<rootA>'));
try { L.sql('mysql', `DROP DATABASE IF EXISTS ${db}`); } catch {}
const J = { http: 18811, broker: 19811, name: `snap-${arm}` };
L.startServer(arm, J.name, J.http, J.broker, db, [
  '--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=t-alpha',
  '--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=st-a',
  `--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=${A}`,
]);
await L.waitHealth(J.http);
L.seedRegistry(db, 't-alpha', 'ws-a', 'st-a');
for (const [label, mutate, restore] of [
  ['soft-delete (status=DELETED, deleted_at set)', "status='DELETED', deleted_at=1", "status='ACTIVE', deleted_at=NULL"],
  ['rebind (workspace_storage_id changed)', "workspace_storage_id='st-other'", "workspace_storage_id='st-a'"],
]) {
  const sid = (await L.createSession(J.http, 't-alpha', 'alice', 'ws-a', '.')).json.id;
  const rt = `rt-${label.slice(0, 4)}`;
  say(label, `acquire: ${L.brief(await L.acquire(J.broker, sid, rt)).slice(0, 40)}`);
  L.sql(db, `UPDATE managed_agent_session SET ${mutate} WHERE session_id='${sid}'`);
  const w = await L.run(J.broker, sid, rt, 'write_file', { file_path: `${A}/${rt}.txt`, content: 'x' });
  say(label, `write after the row change: ${L.outcome(w)}; file exists: ${fs.existsSync(`${A}/${rt}.txt`)}`);
  say(label, `release: ${L.brief(await L.release(J.broker, sid, rt)).slice(0, 80)}; holders: ${JSON.stringify(L.holders(db))}`);
  L.sql(db, `UPDATE managed_agent_session SET ${restore} WHERE session_id='${sid}'`);
}
L.stopServer(J.name);
await L.sleep(5000);
