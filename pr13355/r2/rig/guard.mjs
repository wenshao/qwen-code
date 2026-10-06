// VERIFICATION RIG ONLY (PR #13355): the deletion guard at the task-journal
// announcement point, driven through a real Spring Session Store on MySQL
// 8.4.7 by the real TypeScript authority (openManagedSession over
// createHttpManagedSessionStores, as the Hosted Harness opens a Session).
//
// midcommit: a MySQL client holds the Stage H record row, so the real commit
//   of Monitor revision 2 blocks at its UPDATE -- after its first consistent
//   read (snapshot) and before the guard. While it waits, the public Session
//   row turns DELETING and commits; then the hold is released. The question:
//   does the task journal gain a row after the deletion committed?
// lockwait: a MySQL client holds the public Session row FOR UPDATE for HOLD
//   ms. Session A commits revision 2 (a view change); 800 ms later Session B
//   of the same tenant commits its revision 1. Both latencies are reported.
//
// usage: node guard.mjs <springBaseUrl> <arm> <db> <midcommit|lockwait|control> [resultsFile]
import { randomUUID, createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CORE = '/Users/wenshao/git/pr13355-head/packages/core/dist/src';
const { createHttpManagedSessionStores } = await import(`${CORE}/managed-runtime/http-managed-session-store.js`);
const { openManagedSession } = await import(`${CORE}/managed-runtime/managed-session-assembly.js`);
const { MANAGED_SESSION_ENABLED_DOMAINS } = await import(`${CORE}/managed-runtime/managed-session-records.js`);
if (!MANAGED_SESSION_ENABLED_DOMAINS.includes('monitor_run')) MANAGED_SESSION_ENABLED_DOMAINS.push('monitor_run');

const [base, arm, db, mode, resultsFile] = process.argv.slice(2);
const MYSQL = '/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql';
const SOCK = '/Users/wenshao/git/pr13355-rig/mysql.sock';
const HOLD = Number(process.env.HOLD_MS ?? 3000);
const TENANT = `tenant-13355g-${mode}`;
const WORKSPACE = 'ws-13355';
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MONITOR = JSON.parse(readFileSync('/Users/wenshao/git/pr13355-head/packages/core/src/managed-runtime/contracts/managed-extension-projection-v1.fixtures.json', 'utf8')).monitorChainCases[0].revisions;

function sql(q) {
  const r = spawnSync(MYSQL, ['--no-defaults', '-uroot', `--socket=${SOCK}`, '-N', '-B', db, '-e', q], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`mysql: ${r.stderr}`);
  return r.stdout.trim();
}
// A held client transaction: statements go in over stdin and the client
// keeps the transaction open until COMMIT is written.
function holder(statements) {
  const child = spawn(MYSQL, ['--no-defaults', '-uroot', `--socket=${SOCK}`, '-N', '-B', '--unbuffered', db], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.stdin.write(statements + '\n');
  return {
    release: () => new Promise((resolve) => { child.on('exit', () => resolve(out)); child.stdin.end('COMMIT;\n'); }),
    output: () => out,
  };
}

async function openSession(sessionId) {
  const key = { tenantId: TENANT, workspaceId: WORKSPACE, sessionId };
  const cwd = mkdtempSync(path.join(tmpdir(), 'g13355-'));
  const stores = createHttpManagedSessionStores({ baseUrl: base, sessionKey: key, writerId: `harness-${randomUUID().slice(0, 8)}`, leaseDurationMs: 60_000 });
  const create = {
    definitionRef: await stores.resourceStore.publish('managed-definition', Buffer.from(JSON.stringify({ engine: 'managed', sessionId }))),
    rootSnapshotRef: await stores.resourceStore.publish('managed-root', Buffer.from(JSON.stringify({ cwd }))),
    createdBy: 'hosted-harness',
  };
  const session = await openManagedSession({
    runtimeBaseDir: cwd, transcriptPath: '', sessionId, sessionKey: key, cwd, version: 'hosted-harness/1',
    workerId: 'probe-worker', activationLeaseDurationMs: 60_000,
    journalStore: stores.journalStore, resourceStore: stores.resourceStore, create, requireNew: true,
  });
  const now = Date.now();
  sql(`INSERT INTO managed_agent_session (tenant_id, session_id, agent_id, status, created_at, updated_at) VALUES ('${TENANT}', '${sessionId}', 'qwen-code', 'ACTIVE', ${now}, ${now})`);
  const argsRef = await session.resources.publish('managed-tool-args', Buffer.from(JSON.stringify({ monitor: sessionId })));
  return { key, session, argsRef };
}

async function revision(s, n) {
  const record = { ...MONITOR[n - 1].monitorRun, commandRef: s.argsRef };
  const t0 = Date.now();
  try {
    const r = await s.session.authority.commitExtensionRecord(
      { operation: 'commitExtensionRecord', commandId: `monitor-rev-${n}-${randomUUID().slice(0, 6)}`, sessionKey: s.key, contentDigest: sha256(JSON.stringify(record)) },
      { domain: 'monitor_run', record }, { class: 'trusted_entry' });
    return { ok: true, ms: Date.now() - t0, sequence: r.receipt.firstSequence };
  } catch (error) {
    return { ok: false, ms: Date.now() - t0, error: String(error?.message ?? error).slice(0, 200) };
  }
}
const journalRows = (sessionId) => Number(sql(`SELECT COUNT(*) FROM qwen_managed_session_task_journal WHERE tenant_id='${TENANT}' AND session_id='${sessionId}'`));
const recordRevision = (sessionId) => sql(`SELECT revision FROM qwen_managed_session_extension_record WHERE tenant_id='${TENANT}' AND session_id='${sessionId}'`);
const lockWaits = () => Number(sql(`SELECT COUNT(*) FROM information_schema.innodb_trx t JOIN information_schema.processlist p ON p.id = t.trx_mysql_thread_id WHERE t.trx_state = 'LOCK WAIT' AND p.db = '${db}'`));
function emit(row) {
  console.log(`RESULT\t${JSON.stringify(row)}`);
  if (resultsFile) appendFileSync(resultsFile, JSON.stringify(row) + '\n');
}

const id = (p) => `g13355-${arm}-${p}-${randomUUID().slice(0, 8)}`;
if (mode === 'midcommit') {
  const a = await openSession(id('mid'));
  await revision(a, 1);
  const before = journalRows(a.key.sessionId);
  const h = holder(`BEGIN; SELECT record_key FROM qwen_managed_session_extension_record WHERE tenant_id='${TENANT}' AND session_id='${a.key.sessionId}' FOR UPDATE;`);
  await sleep(500);
  const pending = revision(a, 2);
  let blocked = false;
  for (let i = 0; i < 40 && !blocked; i++) { await sleep(250); blocked = lockWaits() > 0; }
  sql(`UPDATE managed_agent_session SET status='DELETING', updated_at=${Date.now()}, version=version+1 WHERE tenant_id='${TENANT}' AND session_id='${a.key.sessionId}'`);
  const statusAfterDelete = sql(`SELECT status FROM managed_agent_session WHERE tenant_id='${TENANT}' AND session_id='${a.key.sessionId}'`);
  await h.release();
  const rev2 = await pending;
  const after = journalRows(a.key.sessionId);
  emit({ arm, mode, sessionId: a.key.sessionId, blockedAfterSnapshot: blocked, statusAfterDelete, rev2, recordRevision: recordRevision(a.key.sessionId), journalBefore: before, journalAfter: after, journalAddedAfterDeletion: after - before });
  await a.session.close?.();
} else if (mode === 'lockwait' || mode === 'control') {
  const a = await openSession(id('a'));
  const b = await openSession(id('b'));
  await revision(a, 1);
  const h = mode === 'lockwait'
    ? holder(`BEGIN; SELECT status FROM managed_agent_session WHERE tenant_id='${TENANT}' AND session_id='${a.key.sessionId}' FOR UPDATE;`)
    : undefined;
  await sleep(300);
  const pa = revision(a, 2);
  await sleep(800);
  const pb = revision(b, 1);
  await sleep(HOLD - 800);
  const waitsWhileHeld = lockWaits();
  if (h) await h.release();
  const [ra, rb] = await Promise.all([pa, pb]);
  emit({ arm, mode, holdMs: h ? HOLD : 0, waitsWhileHeld, sessionA_rev2: ra, sessionB_rev1_sameTenant: rb });
  await a.session.close?.(); await b.session.close?.();
}
process.exit(0);
