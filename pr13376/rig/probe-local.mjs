// Local on-disk probe for PR 13376: the arm's built core dist opens the
// session through openManagedSession with no journal/resource override, i.e.
// the local JSONL log + local resource files the CLI's Managed log uses
// (config.ts openManagedSessionLog). Each phase runs in its own process.
//
// usage: node probe-local.mjs <arm> <scenario|all> [resultsFile]
//        node probe-local.mjs <arm> __child <phase> <root>
import { randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [arm, which, ...rest] = process.argv.slice(2);
const CORE = `/Users/wenshao/git/pr13376-${arm}/packages/core/dist/src`;
const { openManagedSession } = await import(`${CORE}/managed-runtime/managed-session-assembly.js`);
const { LocalManagedSessionResourceStore } = await import(`${CORE}/managed-runtime/managed-session-resources.js`);
const { readManagedSessionTitleInfoSync } = await import(`${CORE}/utils/sessionStorageUtils.js`);
const msg = (e) => (e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e));
const SESSION = '550e8400-e29b-41d4-a716-44665544d376';
const key = { tenantId: 'local', workspaceId: 'ws-local-13376', sessionId: SESSION };
const TRUSTED = { class: 'trusted_entry' };
const rename = (commandId) => ({ operation: 'renameSession', commandId, sessionKey: key, contentDigest: 'd'.repeat(64) });
const title = (t) => ({ domain: 'session_metadata', content: { title: t, titleSource: 'manual' } });

function paths(root) {
  return {
    runtimeBaseDir: path.join(root, 'runtime'),
    transcriptPath: path.join(root, 'runtime', 'chats', `${SESSION}.jsonl`),
    bodies: path.join(root, 'runtime', 'resources', SESSION, 'managed-session_metadata'),
  };
}
const count = (dir) => {
  try {
    return readdirSync(dir).length;
  } catch {
    return 0;
  }
};

async function open(root, create) {
  const p = paths(root);
  mkdirSync(p.runtimeBaseDir, { recursive: true });
  mkdirSync(path.dirname(p.transcriptPath), { recursive: true });
  const resources = LocalManagedSessionResourceStore.create({ runtimeBaseDir: p.runtimeBaseDir, sessionKey: key });
  const createRefs = create
    ? {
        definitionRef: await resources.publish('managed-definition', Buffer.from('{}')),
        rootSnapshotRef: await resources.publish('managed-root', Buffer.from('{}')),
        createdBy: 'daemon',
      }
    : undefined;
  return openManagedSession({
    runtimeBaseDir: p.runtimeBaseDir,
    sessionId: SESSION,
    transcriptPath: p.transcriptPath,
    sessionKey: key,
    cwd: root,
    version: 'probe-13376',
    workerId: SESSION,
    activationLeaseDurationMs: 300_000,
    resourceStore: resources,
    ...(createRefs ? { create: createRefs } : {}),
  });
}

async function attempt(fn) {
  try {
    const r = await fn();
    return { ok: true, r, text: `OK replayed=${r.receipt.replayed === true} rev=${r.revision} ref=${r.recordRef.resourceId.slice(0, 8)}` };
  } catch (e) {
    return { ok: false, text: `REFUSED ${msg(e).slice(0, 110)}` };
  }
}

async function childMain(phase, root) {
  const p = paths(root);
  if (phase === 'commit') {
    const s = await open(root, true);
    const r = await s.authority.commitDomainRecord(rename('cmd-1'), title('First'), TRUSTED);
    await s.close();
    return { pid: process.pid, text: `rev=${r.revision} ref=${r.recordRef.resourceId.slice(0, 8)}`, ref: r.recordRef.resourceId, bodies: count(p.bodies) };
  }
  if (phase === 'retry10') {
    const s = await open(root, false);
    let last;
    for (let i = 0; i < 10; i++) last = await attempt(() => s.authority.commitDomainRecord(rename('cmd-1'), title('First'), TRUSTED));
    await s.close();
    return { pid: process.pid, text: last.text, ref: last.ok ? last.r.recordRef.resourceId : null, bodies: count(p.bodies) };
  }
  if (phase === 'title') {
    return { pid: process.pid, text: JSON.stringify(readManagedSessionTitleInfoSync(p.transcriptPath, p.runtimeBaseDir)), bodies: count(p.bodies) };
  }
  if (phase === 'stopped-writer') {
    // Commit, then make the log unwritable so the next append latches the
    // writer's failure; then retry the command it already committed.
    const s = await open(root, true);
    const r = await s.authority.commitDomainRecord(rename('cmd-1'), title('First'), TRUSTED);
    chmodSync(p.transcriptPath, 0o444);
    const fresh = await attempt(() => s.authority.commitDomainRecord(rename('cmd-2'), title('Second'), TRUSTED));
    const retry = await attempt(() => s.authority.commitDomainRecord(rename('cmd-1'), title('First'), TRUSTED));
    chmodSync(p.transcriptPath, 0o644);
    await s.close().catch(() => undefined);
    return { pid: process.pid, text: `cmd-1 rev=${r.revision}; fresh cmd-2 after chmod 444: ${fresh.text}; retry cmd-1: ${retry.text}`, bodies: count(p.bodies) };
  }
  throw new Error(phase);
}

if (which === '__child') {
  const [phase, root] = rest;
  console.log(JSON.stringify(await childMain(phase, root)));
  process.exit(0);
}

const child = (phase, root) =>
  JSON.parse(execFileSync(process.execPath, [process.argv[1], arm, '__child', phase, root], { encoding: 'utf8' }).trim().split('\n').at(-1));

const SCENARIOS = {
  'cross-process-retry-x10': () => {
    const root = mkdtempSync(path.join(tmpdir(), `p13376-local-${arm}-`));
    const a = child('commit', root);
    const b = child('retry10', root);
    const c = child('title', root);
    return [
      `process A (pid ${a.pid}) committed cmd-1: ${a.text}; metadata bodies on disk=${a.bodies}`,
      `process B (pid ${b.pid}) reopened, retried cmd-1 x10: last ${b.text} sameRefAsCommitted=${b.ref === a.ref}; metadata bodies on disk=${b.bodies}`,
      `process C (pid ${c.pid}) session-list title reader: ${c.text}; metadata bodies on disk=${c.bodies}`,
    ];
  },
  'stopped-writer-retry': () => {
    const root = mkdtempSync(path.join(tmpdir(), `p13376-local-${arm}-`));
    const a = child('stopped-writer', root);
    return [`process (pid ${a.pid}): ${a.text}; metadata bodies on disk=${a.bodies}`];
  },
};

const resultsFile = rest[0];
const names = which === 'all' ? Object.keys(SCENARIOS) : which.split(',');
for (const n of names) {
  let lines;
  try {
    lines = SCENARIOS[n]();
  } catch (e) {
    lines = [`ERROR ${e.stack}`];
  }
  for (const l of lines) console.log(`RESULT\t${arm}\t${n}\t${l}`);
  if (resultsFile) appendFileSync(resultsFile, JSON.stringify({ arm, scenario: n, lines }) + '\n');
}
process.exit(0);
