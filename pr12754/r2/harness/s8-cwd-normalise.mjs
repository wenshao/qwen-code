// Does W0b creation reject cwd_relative values that could escape the mount?
// (Decides whether the fix's startsWith(base) clause is reachable.)
import * as L from './lib.mjs';
import fs from 'node:fs';

const arm = process.argv[2] ?? 'h4';
const db = `rig_norm_${arm}`;
const A = `${L.RIG}/roots/norm-${arm}`;
fs.rmSync(A, { recursive: true, force: true });
fs.mkdirSync(A, { recursive: true });
L.openLog(`s8-cwd-normalise-${arm}`);
try { L.sql('mysql', `DROP DATABASE IF EXISTS ${db}`); } catch {}
const J = { http: 18841, broker: 19841, name: `norm-${arm}` };
L.startServer(arm, J.name, J.http, J.broker, db, [
  '--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=t-alpha',
  '--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=st-a',
  `--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=${A}`,
]);
await L.waitHealth(J.http);
L.seedRegistry(db, 't-alpha', 'ws-a', 'st-a');
for (const cwd of ['..', '../x', 'a/../b', 'a/./b', '/abs', 'a\\b', 'C:x', './a', 'a/', 'ok/child']) {
  const r = await L.createSession(J.http, 't-alpha', 'alice', 'ws-a', cwd);
  const saved = r.status === 202 ? L.sql(db, `SELECT cwd_relative FROM managed_agent_session WHERE session_id='${r.json.id}'`)[0][0] : '-';
  L.say(arm, `cwd_relative=${JSON.stringify(cwd)} -> ${r.status} ${r.status === 202 ? '' : JSON.stringify(r.json?.error?.code ?? r.json)} saved=${saved}`);
}
L.stopServer(J.name);
await L.sleep(4000);
