// PR #13138 (W1b) helpers on top of the W1a rig library: the packaged maintenance jar, request files,
// authority snapshots, operator copies and a scripted population of one shared storage.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

export const BUNDLE_JAR = process.env.BUNDLE_JAR ?? '/opt/w1c/head-server-workspace-bundle.jar';
export const NODE = '/opt/qwen/node';
export const CLI = (dist = process.env.CLI_DIST ?? L.env().DIST) => `/opt/w1c/${dist}/cli.js`;
export const BUNDLES = '/srv/w1c-bundles';
export const REQ = '/var/lib/qwen-w1c/requests';
fs.mkdirSync(REQ, { recursive: true });
export const historyRoot = (db = L.DB()) => `/var/lib/qwen-w1c/home-${db}/file-history`;
const OSS_JVM = ['-Djdk.net.hosts.file=/opt/w1c/o2/tls/hosts', '-Djavax.net.ssl.trustStore=/opt/w1c/o2/tls/trust.jks', '-Djavax.net.ssl.trustStorePassword=rigtrust'];
export const OSS_ENV = { W1_OSS_ENDPOINT: 'https://oss-cn-hangzhou.aliyuncs.com', W1_OSS_REGION: 'cn-hangzhou', W1_OSS_BUCKET: 'rig-bucket', OSS_ACCESS_KEY_ID: 'rig-ak', OSS_ACCESS_KEY_SECRET: 'rig-sk' };

// Peak RSS of a process tree (java + the node child), sampled from /proc every 100 ms.
function sampler(rootPid) {
  const peak = { java: 0, node: 0, nodePids: new Set() };
  // The JVM forks the worker from a non-main thread: collect children of every task.
  const kids = (pid) => { try { return fs.readdirSync(`/proc/${pid}/task`).flatMap((t) => { try { return fs.readFileSync(`/proc/${pid}/task/${t}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number); } catch { return []; } }); } catch { return []; } };
  const hwm = (pid) => { try { const m = fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmHWM:\s+(\d+) kB/); return m ? Number(m[1]) : 0; } catch { return 0; } };
  const timer = setInterval(() => {
    peak.java = Math.max(peak.java, hwm(rootPid));
    for (const k of kids(rootPid)) { peak.nodePids.add(k); peak.node = Math.max(peak.node, hwm(k)); }
  }, 100);
  return { stop: () => { clearInterval(timer); return { javaMiB: Math.round(peak.java / 1024), nodeMiB: Math.round(peak.node / 1024), nodeChildren: peak.nodePids.size }; } };
}

// The operator's packaged maintenance command: java -jar <workspace-bundle jar> <cmd> <request> [--offline-confirmed].
// Async so the caller can interrupt it (SIGKILL after a delay, or when a predicate on SQL progress holds).
export async function w1b(cmd, request, { label = cmd, jar = BUNDLE_JAR, offline = cmd !== 'inspect', oss = false, extraEnv = {}, killAfterMs, killWhen, db = L.DB(), quiet = false, rawFile, tz = 'UTC' } = {}) {
  const cfg = L.env();
  const file = rawFile ?? path.join(REQ, `${request.operationId}-${cmd}-${Date.now()}.json`);
  if (!rawFile) fs.writeFileSync(file, JSON.stringify(request));
  const env = { PATH: '/usr/local/bin:/usr/bin:/bin', W1_JDBC_URL: `jdbc:mysql://127.0.0.1:${cfg.DBPORT || 3306}/${db}?allowPublicKeyRetrieval=true&useSSL=false`,
    W1_JDBC_USER: 'root', W1_JDBC_PASSWORD: cfg.DBPASS || 'rootpw', ...(oss ? OSS_ENV : {}), ...extraEnv };
  for (const [k, v] of Object.entries(env)) if (v === null) delete env[k];
  const args = [...(oss ? OSS_JVM : []), ...(tz ? [`-Duser.timezone=${tz}`] : []), '-jar', jar, cmd, file, ...(offline ? ['--offline-confirmed'] : [])];
  const t0 = Date.now();
  const child = spawn('/opt/qwen/jdk/bin/java', args, { env, cwd: '/tmp', stdio: ['ignore', 'pipe', 'pipe'] });
  const s = sampler(child.pid);
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
  let killed = null;
  const timers = [];
  if (killAfterMs !== undefined) timers.push(setTimeout(() => { killed = `SIGKILL after ${Date.now() - t0} ms`; killTree(child.pid); }, killAfterMs));
  if (killWhen) { const poll = setInterval(() => { try { if (!killed && killWhen()) { killed = `SIGKILL when ${killWhen.label ?? 'predicate'} held (${Date.now() - t0} ms)`; killTree(child.pid); } } catch { /* sql busy */ } }, 50); timers.push(poll); }
  const code = await new Promise((r) => child.on('close', (c, sig) => r(c ?? sig)));
  for (const t of timers) { clearTimeout(t); clearInterval(t); }
  const mem = s.stop();
  const lines = stdout.split('\n').filter((l) => l.trim());
  let json = null; try { json = JSON.parse(lines.at(-1) ?? ''); } catch { /* not json */ }
  const cause = [...`${stdout}\n${stderr}`.matchAll(/(?:Exception|Error|Failure): ([^\n]+)/g)].map((m) => m[1]).at(-1) ?? '';
  const workerLine = stderr.split('\n').find((l) => /^[a-z0-9_]{1,64}: /.test(l)) ?? '';
  const r = { cmd, code, ms: Date.now() - t0, json, cause, workerLine, stdout, stderr, killed, mem, file };
  fs.writeFileSync(path.join(L.OUT, `w1b-${label.replace(/[^a-z0-9-]+/gi, '_')}.txt`), `$ java ${args.join(' ')}\nexit=${code} ms=${r.ms} killed=${killed} mem=${JSON.stringify(mem)}\n--- request\n${fs.readFileSync(file, 'utf8')}\n--- stdout\n${stdout}\n--- stderr\n${stderr}`);
  if (!quiet) L.say(`  w1b ${label}: exit=${code} ${r.ms} ms${killed ? ` [${killed}]` : ''} java≤${mem.javaMiB} MiB node≤${mem.nodeMiB} MiB -> ${summary(r)}`);
  return r;
}
function killTree(pid) {
  try { for (const t of fs.readdirSync(`/proc/${pid}/task`)) { try { for (const k of fs.readFileSync(`/proc/${pid}/task/${t}/children`, 'utf8').trim().split(/\s+/).filter(Boolean)) process.kill(Number(k), 'SIGKILL'); } catch { /* gone */ } } } catch { /* gone */ }
  try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}
export function summary(r) {
  if (r.json) {
    const j = r.json; const res = j.result ?? {};
    return `state=${j.state} sessions=${j.completedSessions}/${j.sessionCount} assets=${j.assets} pendingRefs=${j.pendingReferences} lastError=${j.lastErrorCode}` +
      (j.result ? ` contentVerified=${res.contentVerified} authorityCompatible=${res.authorityCompatible} activation=${res.activation} entries=${res.entries}` : '') +
      (j.manifestDigest ? ` manifest=${j.manifestDigest.slice(0, 12)}` : '');
  }
  return `REFUSED ${r.workerLine || r.cause || r.stderr.trim().split('\n').at(-1) || '(no output)'}`;
}
export function opRow(id) {
  const r = L.sql(`SELECT state, IFNULL(last_error_code,'-'), IFNULL(manifest_digest,'-'), session_count, (SELECT COUNT(*) FROM managed_workspace_recovery_session s WHERE s.operation_id=o.operation_id AND s.state='COMPLETE'), (SELECT COUNT(*) FROM managed_workspace_recovery_work w WHERE w.operation_id=o.operation_id AND w.work_kind='ASSET'), (SELECT COUNT(*) FROM managed_workspace_recovery_work w WHERE w.operation_id=o.operation_id AND w.work_kind='REF') FROM managed_workspace_recovery_operation o WHERE operation_id='${id}'`)[0];
  return r ? { state: r[0], error: r[1], manifest: r[2], sessions: Number(r[3]), complete: Number(r[4]), assets: Number(r[5]), refs: Number(r[6]) } : null;
}
export const opStr = (o) => o ? `row state=${o.state} lastError=${o.error} sessions=${o.complete}/${o.sessions} assets=${o.assets} refs=${o.refs} manifest=${o.manifest.slice(0, 12)}` : 'row <none>';

export function captureRequest({ op = randomUUID(), fence, revision, storage = 'a', bundle, history = historyRoot(), dist, ...extra }) {
  return { version: 1, operationId: op, tenantId: L.TENANT, storageId: `st-${storage}`, fenceOperationId: fence, mountRevision: revision,
    sourceRoot: L.root(storage), bundleRoot: bundle, fileHistoryRoot: history, nodeExecutable: NODE, cliEntry: CLI(dist), ...extra };
}
export const verifyRequest = (capture, op = randomUUID()) => ({ ...capture, operationId: op, captureOperationId: capture.operationId });
export const inspectRequest = (op, storage = 'a', afterSessionId) => ({ version: 1, operationId: op, tenantId: L.TENANT, storageId: `st-${storage}`, ...(afterSessionId ? { afterSessionId } : {}) });

// ---- authority snapshot: every table except the derived recovery metadata, dumped in primary-key order.
export function authoritySnapshot(label) {
  const db = L.DB(); const cfg = L.env();
  const tables = L.sql(`SELECT table_name FROM information_schema.tables WHERE table_schema='${db}' AND table_name NOT LIKE 'managed_workspace_recovery_%' AND table_name <> 'flyway_schema_history' ORDER BY table_name`).map((r) => r[0]);
  const out = {}; let all = createHash('sha256');
  for (const t of tables) {
    const dump = spawnSync('docker', ['exec', cfg.DBCONT || 'w0e3-db', 'mysqldump', '-uroot', `-p${cfg.DBPASS || 'rootpw'}`, '--skip-dump-date', '--order-by-primary', '--no-create-info', '--skip-extended-insert', '--hex-blob', db, t], { encoding: 'buffer', maxBuffer: 1 << 30 });
    const h = createHash('sha256').update(dump.stdout).digest('hex');
    out[t] = { sha: h.slice(0, 16), rows: dump.stdout.toString('utf8').split('\nINSERT INTO').length - 1 };
    all.update(`${t}:${h}\n`);
  }
  const digest = all.digest('hex');
  fs.writeFileSync(path.join(L.OUT, `authority-${label}.json`), JSON.stringify({ digest, tables: out }, null, 1));
  return { digest, tables: out };
}
export function diffSnapshots(a, b) {
  return Object.keys({ ...a.tables, ...b.tables }).filter((t) => a.tables[t]?.sha !== b.tables[t]?.sha).map((t) => `${t}(${a.tables[t]?.rows ?? 0}→${b.tables[t]?.rows ?? 0})`);
}
// Tree digest (names, types, modes, sizes, content) — used to show the original tree is untouched.
export function treeDigest(dir) {
  if (!fs.existsSync(dir)) return '<absent>';
  return L.sh(`cd ${dir} && find . -printf '%y %m %s %p %l\\n' | LC_ALL=C sort | sha256sum | cut -c1-16; cd ${dir} && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum | sha256sum | cut -c1-16`).split('\n').join('/');
}

// ---- the operator's copies: Workspace tree and the retained worker file-history directories of member Sessions
export function prepareBundle(name, { storage = 'a', sessions = [], history = historyRoot() } = {}) {
  const b = path.join(BUNDLES, name);
  L.sh(`rm -rf ${b} && mkdir -p ${b}/file-history && cp -a ${L.root(storage)} ${b}/workspace`);
  const copied = [];
  for (const s of sessions) if (fs.existsSync(path.join(history, s))) { L.sh(`cp -a ${history}/${s} ${b}/file-history/${s}`); copied.push(s); }
  return { bundle: b, copied };
}
export function bundleFacts(b) {
  const n = (p) => { try { return L.sh(`find ${b}/${p} -mindepth 1 | wc -l`); } catch { return '-'; } };
  return `workspace=${n('workspace')} file-history=${n('file-history')} authority/objects=${n('authority/objects')} .w1-recovery=[${(() => { try { return fs.readdirSync(`${b}/.w1-recovery`).join(','); } catch { return '-'; } })()}] du=${L.sh(`du -sh ${b} | cut -f1`)}`;
}

// ---- writer leases: wait until no journal head in the storage holds a live writer lease
export async function waitLeasesExpired(storage = 'a', maxMs = 120000) {
  const t0 = Date.now();
  for (;;) {
    const live = Number(L.one(`SELECT COUNT(*) FROM qwen_managed_session_journal_head h JOIN managed_agent_session s ON s.tenant_id=h.tenant_id AND s.session_id=h.session_id WHERE s.workspace_storage_id='st-${storage}' AND h.state='ACTIVE' AND h.writer_lease_until > CURRENT_TIMESTAMP(6)`));
    if (live === 0) return Date.now() - t0;
    if (Date.now() - t0 > maxMs) throw new Error(`writer leases still live: ${live}`);
    await L.sleep(1000);
  }
}
export function members(storage = 'a') {
  return L.sql(`SELECT s.session_id, s.workspace_id, s.status, IFNULL(h.state,'-'), IFNULL(h.journal_revision,0), IFNULL(h.committed_sequence,0) FROM managed_agent_session s LEFT JOIN qwen_managed_session_journal_head h ON h.tenant_id=s.tenant_id AND h.session_id=s.session_id WHERE s.tenant_id='${L.TENANT}' AND s.workspace_storage_id='st-${storage}' ORDER BY s.session_id`)
    .map((r) => ({ id: r[0], ws: r[1], status: r[2], head: r[3], rev: Number(r[4]), seq: Number(r[5]) }));
}
export const sha = (s) => createHash('sha256').update(s).digest('hex');
