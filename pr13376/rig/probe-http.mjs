// Real Session Store probe for PR 13376: one Spring Managed Agent Server
// (Session Store enabled, MySQL 8.4.7) and the TypeScript authority from the
// chosen arm's built core dist (openManagedSession over
// createHttpManagedSessionStores, exactly as the Hosted Harness wires it).
//
// usage: node probe-http.mjs <arm: head|base> <scenario|all> [resultsFile]
//        node probe-http.mjs <arm> __child <phase> <sessionId> <json>
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [arm, which, ...rest] = process.argv.slice(2);
const BASE = 'http://127.0.0.1:18376';
const R = '/Users/wenshao/git/pr13376-rig';
const CORE = `/Users/wenshao/git/pr13376-${arm}/packages/core/dist/src`;
const { createHttpManagedSessionStores } = await import(
  `${CORE}/managed-runtime/http-managed-session-store.js`
);
const { openManagedSession } = await import(
  `${CORE}/managed-runtime/managed-session-assembly.js`
);
const TENANT = 'tenant-13376';
const WORKSPACE = 'ws-13376';
const sql = (q) =>
  execFileSync(`${R}/sql.sh`, ['ms13376', '-N', '-B', '-e', q], {
    encoding: 'utf8',
  }).trim();
const msg = (e) =>
  e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e);
const short = (ref) => (ref ? ref.resourceId.slice(0, 8) : 'none');

async function open(key, create) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'p13376-'));
  const stores = createHttpManagedSessionStores({
    baseUrl: BASE,
    sessionKey: key,
    writerId: `harness-${randomUUID().slice(0, 8)}`,
    leaseDurationMs: 60_000,
  });
  const refs = create
    ? {
        definitionRef: await stores.resourceStore.publish(
          'managed-session-definition',
          Buffer.from(JSON.stringify({ model: 'probe', sessionId: key.sessionId })),
        ),
        rootSnapshotRef: await stores.resourceStore.publish(
          'managed-session-root-snapshot',
          Buffer.from('{"version":1,"messages":[]}'),
        ),
        createdBy: 'hosted-harness',
      }
    : undefined;
  const session = await openManagedSession({
    runtimeBaseDir: cwd,
    transcriptPath: '',
    sessionId: key.sessionId,
    sessionKey: key,
    cwd,
    version: 'hosted-harness/1',
    workerId: 'probe-worker',
    activationLeaseDurationMs: 60_000,
    journalStore: stores.journalStore,
    resourceStore: stores.resourceStore,
    ...(refs ? { create: refs, requireNew: true } : {}),
  });
  return { session, stores, cwd };
}

function newKey(name) {
  return {
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    sessionId: `p13376-${name}-${randomUUID().slice(0, 8)}`,
  };
}

const rename = (key, commandId, extra = {}) => ({
  operation: 'renameSession',
  commandId,
  sessionKey: key,
  contentDigest: 'd'.repeat(64),
  ...extra,
});
const title = (t) => ({
  domain: 'session_metadata',
  content: { title: t, titleSource: 'manual' },
});
const TRUSTED = { class: 'trusted_entry' };

// Durable state on the server, straight from MySQL.
function db(key) {
  const s = key.sessionId;
  const head = sql(
    `SELECT CONCAT(journal_revision,'/',committed_sequence) FROM qwen_managed_session_journal_head WHERE session_id='${s}'`,
  );
  const res = sql(
    `SELECT COUNT(*) FROM qwen_managed_session_resource WHERE session_id='${s}' AND kind='managed-session_metadata'`,
  );
  return `head(rev/seq)=${head} metadataBodies=${res}`;
}
function onServer(key, ref) {
  if (!ref) return 'n/a';
  return sql(
    `SELECT COUNT(*) FROM qwen_managed_session_resource WHERE session_id='${key.sessionId}' AND resource_id='${ref.resourceId}'`,
  ) === '1'
    ? 'yes'
    : 'NO';
}
const staged = (stores) => stores.resourceStore.staged.size;

async function readBack(key, ref) {
  // A fresh writer (new stores, new authority) reads the ref the way any
  // later reader would: from the server, with nothing staged in memory.
  const again = await open(key, false);
  try {
    const body = JSON.parse(
      (await again.stores.resourceStore.read(ref)).toString('utf8'),
    );
    return `readable(title=${body.title},rev=${body.revision})`;
  } catch (e) {
    return `UNREADABLE(${msg(e).slice(0, 90)})`;
  } finally {
    await again.session.close().catch(() => undefined);
  }
}

async function attempt(fn) {
  try {
    const r = await fn();
    return {
      ok: true,
      r,
      text: `OK replayed=${r.receipt.replayed === true} rev=${r.revision} ref=${short(r.recordRef)}`,
    };
  } catch (e) {
    return { ok: false, text: `REFUSED ${msg(e).slice(0, 110)}` };
  }
}

const SCENARIOS = {
  // A retried command, ten times (lost receipts on a flaky link).
  'retry-same-x10': async () => {
    const key = newKey('same');
    const { session, stores } = await open(key, true);
    const a = session.authority;
    const first = await a.commitDomainRecord(rename(key, 'cmd-1'), title('First'), TRUSTED);
    const before = `${db(key)} staged=${staged(stores)}`;
    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(await attempt(() => a.commitDomainRecord(rename(key, 'cmd-1'), title('First'), TRUSTED)));
    }
    const last = results.at(-1);
    const sameRef = last.ok && last.r.recordRef.resourceId === first.recordRef.resourceId;
    const after = `${db(key)} staged=${staged(stores)}`;
    await session.close();
    return [
      `first: rev=${first.revision} ref=${short(first.recordRef)}`,
      `before retries: ${before}`,
      `retry #10: ${last.text} sameRefAsCommitted=${sameRef} retryRefOnServer=${last.ok ? onServer(key, last.r.recordRef) : 'n/a'}`,
      `after 10 retries: ${after}`,
      `fresh reader on retry ref: ${last.ok ? await readBack(key, last.r.recordRef) : 'n/a'}`,
    ];
  },
  // A retry that arrives after a later revision committed.
  'stale-retry': async () => {
    const key = newKey('stale');
    const { session } = await open(key, true);
    const a = session.authority;
    const first = await a.commitDomainRecord(rename(key, 'cmd-1'), title('First'), TRUSTED);
    const second = await a.commitDomainRecord(rename(key, 'cmd-2'), title('Second'), TRUSTED);
    const retry = await attempt(() => a.commitDomainRecord(rename(key, 'cmd-1'), title('First'), TRUSTED));
    const latest = a.domainRecord('session_metadata');
    await session.close();
    return [
      `cmd-1 rev=${first.revision} ref=${short(first.recordRef)}; cmd-2 rev=${second.revision} ref=${short(second.recordRef)}`,
      `retry cmd-1: ${retry.text} sameRefAsCmd1=${retry.ok && retry.r.recordRef.resourceId === first.recordRef.resourceId}`,
      `authority latest session_metadata: rev=${latest?.revision} ref=${short(latest?.recordRef)}; ${db(key)}`,
    ];
  },
  // The caller pinned expectedSequence; the identical command is retried.
  'retry-with-expected-sequence': async () => {
    const key = newKey('expseq');
    const { session } = await open(key, true);
    const a = session.authority;
    const pinned = a.committedSequence;
    const first = await a.commitDomainRecord(rename(key, 'cmd-1', { expectedSequence: pinned }), title('First'), TRUSTED);
    const retry = await attempt(() =>
      a.commitDomainRecord(rename(key, 'cmd-1', { expectedSequence: pinned }), title('First'), TRUSTED),
    );
    await session.close();
    return [
      `commit cmd-1 expectedSequence=${pinned}: rev=${first.revision} ref=${short(first.recordRef)}`,
      `identical retry: ${retry.text}`,
      db(key),
    ];
  },
  // A retry with different content under the same command identity.
  'retry-different-content': async () => {
    const key = newKey('diff');
    const { session, stores } = await open(key, true);
    const a = session.authority;
    await a.commitDomainRecord(rename(key, 'cmd-1'), title('First'), TRUSTED);
    const s0 = staged(stores);
    const retry = await attempt(() =>
      a.commitDomainRecord(rename(key, 'cmd-1', { contentDigest: 'e'.repeat(64) }), title('Other'), TRUSTED),
    );
    const s1 = staged(stores);
    await session.close();
    return [`retry with other digest: ${retry.text}`, `staged ${s0} -> ${s1}; ${db(key)}`];
  },
  // The command is retried naming another domain.
  'retry-other-domain': async () => {
    const key = newKey('otherdom');
    const { session } = await open(key, true);
    const a = session.authority;
    const first = await a.commitDomainRecord(rename(key, 'cmd-1'), title('First'), TRUSTED);
    const retry = await attempt(() =>
      a.commitDomainRecord(rename(key, 'cmd-1'), { domain: 'goal_state', content: { goal: 'x' } }, TRUSTED),
    );
    const goal = a.domainRecord('goal_state');
    await session.close();
    return [
      `cmd-1 session_metadata rev=${first.revision} ref=${short(first.recordRef)}`,
      `retry as goal_state: ${retry.text}`,
      `authority goal_state record: ${goal ? `rev=${goal.revision}` : 'none'}`,
    ];
  },
  // The production entry: the recorder's sink receives the same title record
  // (same uuid) twice.
  'sink-redelivered-title': async () => {
    const key = newKey('sink');
    const { session, stores, cwd } = await open(key, true);
    const record = {
      uuid: randomUUID(),
      parentUuid: null,
      sessionId: key.sessionId,
      timestamp: new Date().toISOString(),
      type: 'system',
      subtype: 'custom_title',
      cwd,
      version: 'hosted-harness/1',
      systemPayload: { customTitle: 'Recorded title', titleSource: 'manual' },
    };
    await session.sink.write(record);
    const once = `${db(key)} staged=${staged(stores)}`;
    let second;
    try {
      await session.sink.write({ ...record });
      second = 'second write resolved';
    } catch (e) {
      second = `second write REFUSED ${msg(e)}`;
    }
    const twice = `${db(key)} staged=${staged(stores)}`;
    await session.close();
    return [`after 1st write: ${once}`, `${second}; after 2nd write: ${twice}`];
  },
  // Cold reopen in separate processes: process A commits and exits, process
  // B is a new writer that retries, process C reads B's answer back.
  'cold-reopen-retry': async () => {
    const key = newKey('cold');
    const child = (phase, extra = {}) =>
      JSON.parse(
        execFileSync(process.execPath, [process.argv[1], arm, '__child', phase, key.sessionId, JSON.stringify(extra)], {
          encoding: 'utf8',
          env: { ...process.env, NO_PROXY: '127.0.0.1,localhost' },
        }).trim().split('\n').at(-1),
      );
    const a = child('commit');
    const b = child('retry');
    const c = child('read', { ref: b.ref });
    return [
      `process A (pid ${a.pid}) committed cmd-1: rev=${a.rev} ref=${a.ref.resourceId.slice(0, 8)}`,
      `process B (pid ${b.pid}) new writer retried cmd-1: ${b.text} sameRefAsCommitted=${b.ref ? b.ref.resourceId === a.ref.resourceId : 'n/a'} staged=${b.staged}`,
      `process C (pid ${c.pid}) reads B's ref from the server: ${c.text}`,
      db(key),
    ];
  },
};

async function childMain(phase, sessionId, extra) {
  const key = { tenantId: TENANT, workspaceId: WORKSPACE, sessionId };
  if (phase === 'commit') {
    const { session } = await open(key, true);
    const r = await session.authority.commitDomainRecord(rename(key, 'cmd-1'), title('First'), TRUSTED);
    await session.close();
    return { pid: process.pid, rev: r.revision, ref: r.recordRef };
  }
  if (phase === 'retry') {
    const { session, stores } = await open(key, false);
    const r = await attempt(() => session.authority.commitDomainRecord(rename(key, 'cmd-1'), title('First'), TRUSTED));
    const out = { pid: process.pid, text: r.text, ref: r.ok ? r.r.recordRef : null, staged: staged(stores) };
    await session.close();
    return out;
  }
  if (phase === 'read') {
    return { pid: process.pid, text: extra.ref ? await readBack(key, extra.ref) : 'n/a' };
  }
  throw new Error(phase);
}

if (which === '__child') {
  const [phase, sessionId, extra] = rest;
  const out = await childMain(phase, sessionId, JSON.parse(extra));
  console.log(JSON.stringify(out));
  process.exit(0);
}

const resultsFile = rest[0];
const names = which === 'all' ? Object.keys(SCENARIOS) : which.split(',');
for (const n of names) {
  let lines;
  try {
    lines = await SCENARIOS[n]();
  } catch (e) {
    lines = [`ERROR ${e.stack}`];
  }
  for (const l of lines) console.log(`RESULT\t${arm}\t${n}\t${l}`);
  if (resultsFile) appendFileSync(resultsFile, JSON.stringify({ arm, scenario: n, lines }) + '\n');
}
process.exit(0);
