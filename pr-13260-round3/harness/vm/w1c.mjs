// PR #13260 (W1c) helpers on top of the W1a/W1b rig library: the packaged migration jar, request files that are
// written ONCE and reused for every retry (the request digest pins the exact bytes), SQL views of the migration.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';
import * as W from './w1bc.mjs';

export const MIG_JAR = process.env.MIG_JAR ?? '/opt/pr13260/head-server-workspace-migration.jar';
export const homeOf = (db = L.DB()) => `/var/lib/pr13260/home-${db}`;
export const stateDir = (db = L.DB()) => `/var/lib/pr13260/${db}`;
export const CRED = { W1_RUNTIME_CREDENTIAL_KEY_ID: 'rig', W1_RUNTIME_CREDENTIAL_KEY: '/P0zXrDxRumkCOH9wFer9IQp/LnRpDDt7h7KzqlUWfQ=' };

export function migrationRequest({ id = randomUUID(), fence = randomUUID(), capture = randomUUID(), revision, storage = 'a', source, target, bundle,
  history = W.historyRoot(), state = stateDir(), cli = W.CLI(), ...extra }) {
  return { version: 1, migrationOperationId: id, tenantId: L.TENANT, storageId: `st-${storage}`, fenceOperationId: fence, captureOperationId: capture,
    mountRevision: revision, sourceRoot: source, targetRoot: target, bundleRoot: bundle, fileHistoryRoot: history, stateDirectory: state,
    nodeExecutable: W.NODE, cliEntry: cli, ...extra };
}
export function writeRequest(req, name = req.migrationOperationId) {
  const file = path.join(W.REQ, `mig-${name}.json`);
  fs.writeFileSync(file, JSON.stringify(req)); L.chownRig(file);
  return file;
}

// java -jar <migration jar> <cmd> <request.json> [--offline-confirmed], with the maintenance environment the README asks for
// (W1_JDBC_*, W1_RUNTIME_CREDENTIAL_*, and the deployment's canonical QWEN_HOME). Interruptible: killAfterMs, killWhen
// (polled every 20 ms) or killOnWatch {dir, test(eventType, filename)} (inotify via fs.watch, fires within ~1 ms).
export async function mig(cmd, file, { label = cmd, jar = MIG_JAR, home = homeOf(), extraEnv = {}, killAfterMs, killWhen, killOnWatch, offline = cmd !== 'inspect', quiet = false, db = L.DB() } = {}) {
  const cfg = L.env();
  const env = { PATH: '/usr/local/bin:/usr/bin:/bin', W1_JDBC_URL: `jdbc:mysql://127.0.0.1:${cfg.DBPORT || 3306}/${db}?allowPublicKeyRetrieval=true&useSSL=false`,
    W1_JDBC_USER: 'root', W1_JDBC_PASSWORD: cfg.DBPASS || 'rootpw', ...CRED, ...(home === null ? {} : { QWEN_HOME: home }), ...extraEnv };
  for (const [k, v] of Object.entries(env)) if (v === null) delete env[k];
  const args = ['-Duser.timezone=UTC', '-jar', jar, cmd, file, ...(offline ? ['--offline-confirmed'] : [])];
  const t0 = Date.now();
  const child = spawn('/opt/pr13260/jdk/bin/java', args, { ...L.RUNAS, env, cwd: '/tmp', stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
  let killed = null; const timers = []; let watcher = null;
  const kill = (why) => { if (killed) return; killed = `${why} (${Date.now() - t0} ms)`; killTree(child.pid); };
  if (killAfterMs !== undefined) timers.push(setTimeout(() => kill(`SIGKILL after ${killAfterMs} ms`), killAfterMs));
  if (killWhen) timers.push(setInterval(() => { try { if (killWhen()) kill(`SIGKILL when ${killWhen.label ?? 'predicate'}`); } catch { /* busy */ } }, 20));
  if (killOnWatch) watcher = fs.watch(killOnWatch.dir, (ev, name) => { if (killOnWatch.test(ev, String(name))) kill(`SIGKILL on inotify ${ev} ${name}`); });
  const code = await new Promise((r) => child.on('close', (c, sig) => r(c ?? sig)));
  for (const t of timers) { clearTimeout(t); clearInterval(t); }
  watcher?.close();
  const lines = stdout.split('\n').filter((l) => l.trim());
  let json = null; try { json = JSON.parse(lines.at(-1) ?? ''); } catch { /* not json */ }
  const cause = [...`${stdout}\n${stderr}`.matchAll(/(?:Exception|Error|Failure): ([^\n]+)/g)].map((m) => m[1]).at(-1) ?? '';
  const workerLine = stderr.split('\n').find((l) => /^[a-z0-9_]{1,64}: /.test(l)) ?? '';
  const r = { cmd, code, ms: Date.now() - t0, json, cause, workerLine, stdout, stderr, killed };
  fs.writeFileSync(path.join(L.OUT, `mig-${label.replace(/[^a-z0-9-]+/gi, '_')}.txt`), `$ QWEN_HOME=${env.QWEN_HOME ?? '<unset>'} java ${args.join(' ')}\nexit=${code} ms=${r.ms} killed=${killed}\n--- request\n${fs.readFileSync(file, 'utf8')}\n--- stdout\n${stdout}\n--- stderr\n${stderr}`);
  if (!quiet) L.say(`  mig ${label}: exit=${code} ${r.ms} ms${killed ? ` [${killed}]` : ''} -> ${migSummary(r)}`);
  return r;
}
function killTree(pid) {
  try { for (const t of fs.readdirSync(`/proc/${pid}/task`)) { try { for (const k of fs.readFileSync(`/proc/${pid}/task/${t}/children`, 'utf8').trim().split(/\s+/).filter(Boolean)) process.kill(Number(k), 'SIGKILL'); } catch { /* gone */ } } } catch { /* gone */ }
  try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}
export function migSummary(r) {
  if (r.json) {
    const j = r.json; const res = j.result_json ?? null;
    return `state=${j.state} lastError=${j.lastErrorCode}${res ? ` result: revision=${res.mountRevision} contentVerified=${res.contentVerified} authorityCompatible=${res.authorityCompatible} manifest=${String(res.manifestDigest).slice(0, 12)}` : ''}`;
  }
  return `REFUSED ${r.workerLine || r.cause || r.stderr.trim().split('\n').at(-1) || '(no output)'}`;
}
export function migRow(id) {
  const r = L.sql(`SELECT state, IFNULL(last_error_code,'-'), IFNULL(verify_operation_id,'-'), IFNULL(result_json,'-'), IFNULL(target_identity_json,'-') FROM managed_workspace_migration WHERE operation_id='${id}'`)[0];
  return r ? { state: r[0], error: r[1], verify: r[2], result: r[3] === '-' ? null : JSON.parse(r[3]), target: r[4] === '-' ? null : JSON.parse(r[4]) } : null;
}
export const migStr = (m) => m ? `migration row state=${m.state} lastError=${m.error}${m.result ? ` revision=${m.result.mountRevision}` : ''}` : 'migration row <none>';
export function fenceRow(storage = 'a') {
  return L.sql(`SELECT operation_id FROM qwen_runtime_storage_fence WHERE tenant_id='${L.TENANT}' AND storage_id='st-${storage}'`)[0]?.[0] ?? null;
}
export function bindings(storage = 'a') {
  return L.sql(`SELECT binding_id, runtime_generation, binding_state, IF(stop_evidence_json IS NULL,'-','stop-evidence'), IFNULL(runtime_endpoint,'-'), canonical_cwd FROM qwen_runtime_binding WHERE tenant_id='${L.TENANT}' AND storage_id='st-${storage}' ORDER BY binding_id`)
    .map((r) => ({ id: r[0], gen: Number(r[1]), state: r[2], stop: r[3], endpoint: r[4], cwd: r[5] }));
}
export const bindingStr = (bs) => bs.length ? Object.entries(bs.reduce((a, b) => { const k = `${b.state}/${b.stop}`; a[k] = (a[k] ?? 0) + 1; return a; }, {})).map(([k, v]) => `${k}×${v}`).join(' ') : 'no bindings';
// Durable worker processes of this rig (pid -> argv), read from /proc.
export function workers() {
  const out = [];
  for (const p of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try { const c = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8').split('\0').join(' '); if (c.includes('/opt/pr13260/') && c.includes('managed-runtime-worker')) out.push({ pid: Number(p), cwd: fs.readlinkSync(`/proc/${p}/cwd`) }); } catch { /* gone */ }
  }
  return out;
}
export const alive = (pid) => { try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')[2] !== 'Z'; } catch { return false; } };
export const markerOf = (root) => { try { return fs.readFileSync(path.join(root, '.qwen-managed-storage.json'), 'utf8'); } catch (e) { return `<${e.code}>`; } };
export const markerBrief = (root) => { try { const m = JSON.parse(markerOf(root)); return `root=${m.root} dev=${m.device} ino=${m.inode} reg=${String(m.registrationId).slice(0, 8)}`; } catch { return markerOf(root).slice(0, 40); } };
export const sha16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
export function stat(p) { try { const s = fs.statSync(p, { bigint: true }); return `dev=${s.dev} ino=${s.ino}`; } catch (e) { return `<${e.code}>`; } }
export const fsOf = (p) => L.sh(`df --output=source,fstype ${p} | tail -1 | tr -s ' '`);

// Durable placements of one storage: binding -> resourceId -> <stateDir>/<resourceId>.json pid.
export function placements(storage = 'a') {
  return L.sql(`SELECT binding_id, binding_state, resource_handle_json FROM qwen_runtime_binding WHERE tenant_id='${L.TENANT}' AND storage_id='st-${storage}' ORDER BY binding_id`).map((r) => {
    let pid = null; try { const id = JSON.parse(r[2]).resourceId; pid = JSON.parse(fs.readFileSync(`${stateDir()}/${id}.json`, 'utf8')).pid; } catch { /* no state file */ }
    return { binding: r[0].slice(0, 8), state: r[1], pid, alive: pid ? alive(pid) : false };
  });
}
export const placementStr = (ps) => ps.map((p) => `${p.binding}:${p.state}:pid ${p.pid ?? '-'} ${p.pid ? (p.alive ? 'ALIVE' : 'gone') : ''}`.trim()).join(', ') || 'none';
