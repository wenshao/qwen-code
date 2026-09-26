// Round 2: every way a Session directory can be unusable at acquire time,
// one storage per variant so a lockout in one cannot mask another.
import * as L from './lib.mjs';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const skey = (st) => createHash('sha256').update(`t-alpha\u0000${st}`).digest('hex');

const arm = process.argv[2] ?? 'h3';
const db = `rig_variants_${arm}`;
const base = `${L.RIG}/roots/var-${arm}`;
fs.rmSync(base, { recursive: true, force: true });
const OUT = `${L.RIG}/roots/var-${arm}-outside`;
fs.mkdirSync(OUT, { recursive: true });
const V = [
  { key: 'a', label: 'cwd_relative does not exist (typo)', cwd: 'typo-dir', prep: () => {} },
  { key: 'b', label: 'directory removed by another Session\'s Shell', cwd: 'docs', prep: (r) => fs.mkdirSync(`${r}/docs`), shellRemove: true },
  { key: 'c', label: 'cwd_relative names a regular file', cwd: 'notes.txt', prep: (r) => fs.writeFileSync(`${r}/notes.txt`, 'x') },
  { key: 'd', label: 'intermediate path component is a symlink', cwd: 'lnk/sub', prep: (r) => { fs.mkdirSync(`${r}/real/sub`, { recursive: true }); fs.symlinkSync(`${r}/real`, `${r}/lnk`); } },
  { key: 'e', label: 'final component is a symlink to outside the mount', cwd: 'out', prep: (r) => fs.symlinkSync(OUT, `${r}/out`) },
];
const mounts = [];
V.forEach((v, i) => {
  v.root = `${base}-${v.key}`;
  fs.rmSync(v.root, { recursive: true, force: true });
  fs.mkdirSync(v.root, { recursive: true });
  v.prep(v.root);
  mounts.push(`--qwen.managed-agent.runtime-broker.workspace-mounts[${i}].tenant-id=t-alpha`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[${i}].storage-id=st-${v.key}`,
    `--qwen.managed-agent.runtime-broker.workspace-mounts[${i}].root=${v.root}`);
});
L.openLog(`s7-variants-${arm}`);
try { L.sql('mysql', `DROP DATABASE IF EXISTS ${db}`); } catch {}
const J = { http: 18831, broker: 19831, name: `var-${arm}` };
L.startServer(arm, J.name, J.http, J.broker, db, mounts);
await L.waitHealth(J.http);
for (const v of V) L.seedRegistry(db, 't-alpha', `ws-${v.key}`, `st-${v.key}`, { actors: ['alice', 'bob'] });
const mk = async (actor, ws, cwd) => {
  const r = await L.createSession(J.http, 't-alpha', actor, ws, cwd);
  if (r.status !== 202) throw new Error(`create ${ws}:${cwd} ${L.brief(r)}`);
  return r.json.id;
};
const holderOf = (key) => {
  const rows = L.sql(db, "SELECT storage_key, IFNULL(runtime_session_id,'<none>') FROM managed_workspace_execution_lease");
  return rows.map((r) => r[1]).join(',') || '[]';
};
for (const v of V) {
  const healthy = await mk('alice', `ws-${v.key}`, '.');
  if (v.shellRemove) {
    const owner = await mk('alice', `ws-${v.key}`, 'docs');
    await L.acquire(J.broker, owner, `own-${v.key}`);
    await L.run(J.broker, owner, `own-${v.key}`, 'run_shell_command', { command: 'cd .. && rm -rf docs', is_background: false });
    await L.release(J.broker, owner, `own-${v.key}`);
  }
  const bad = await mk('bob', `ws-${v.key}`, v.cwd);
  const refused = await L.acquire(J.broker, bad, `bad-${v.key}`);
  const before = (L.sql(db, `SELECT IFNULL(runtime_session_id,'<none>') FROM managed_workspace_execution_lease WHERE storage_key='${skey('st-' + v.key)}'`)[0] ?? ['no row'])[0];
  const ok = await L.acquire(J.broker, healthy, `ok-${v.key}`);
  L.say(`${arm} ${v.key}`, `${v.label} | bob acquire: ${L.brief(refused).slice(0, 60)} | SQL holder of this storage: ${before} | healthy Session same storage: ${L.brief(ok).slice(0, 48)}`);
  if (ok.status === 200) await L.release(J.broker, healthy, `ok-${v.key}`);
}
L.say(arm, `final holders: ${holderOf()}`);
L.stopServer(J.name);
await L.sleep(5000);
