// S3: resource closure (design: "Resource closure"; H0c open question 3).
// Each case runs in a fresh Session, because a store refusal stops the
// writer. For every case: what the authority does, what the Java store
// answers, and whether the same writer can still commit something valid.
//   A  child_run naming refs that were never published
//   B  child_run naming refs published in another Session of the tenant
//   C  mcp_operation naming a never-published argsRef (an enabled domain)
//   D  child_run with ghost refs, client told to omit them from the commit's
//      resource list: does the Java store check the body's refs by itself?
//   E  as D for mcp_operation
import fs from 'node:fs';
import {
  BINDING_1, ENABLED, WT, child, command, commitChild, createPublicSession, javaRows,
  journalCounts, openLog, openSession, publish, recordingFetch, say,
} from './lib.mjs';

if (!ENABLED) throw new Error('S3 needs ENABLE_CHILD_RUN=1');
openLog(process.env.LOGNAME_S3 ?? 's3-closure');
const MCP = JSON.parse(fs.readFileSync(`${WT}/packages/core/src/managed-runtime/contracts/managed-mcp-record-v1.fixtures.json`, 'utf8')).templates;
const ghost = (id, kind) => ({ resourceId: id, kind, schemaVersion: 1, byteLength: 64, digest: 'e'.repeat(64) });
const out = {};

async function fresh(label, { omitGhosts = false } = {}) {
  const pub = await createPublicSession();
  const http = [];
  const ctx = await openSession({ sessionId: pub.id, writerId: `writer-${label}`, create: true, fetchFn: recordingFetch(http) });
  if (omitGhosts) {
    // Leave out of the commit request every ref that this Session never
    // published, as a writer that does not walk the body would.
    const store = ctx.stores.resourceStore;
    const original = store.commitResources.bind(store);
    store.commitResources = (refs) => original(refs).filter((r) => !r.resourceId.startsWith('ghost-'));
    const originalRead = store.read.bind(store);
    void originalRead;
  }
  return { ...ctx, sessionId: pub.id, http };
}

async function attempt(ctx, label, fn) {
  const mark = ctx.http.length;
  const before = journalCounts(ctx.sessionId);
  let outcome;
  try {
    const r = await fn();
    outcome = `COMMITTED rev${r.revision}`;
  } catch (e) {
    outcome = `${e.name}: ${e.message.slice(0, 150)}`;
  }
  const calls = ctx.http.slice(mark).filter((c) => !c.path.startsWith('/resources')).map((c) => `${c.method} ${c.path} ${c.status}`);
  say(label, { outcome, calls, before, after: journalCounts(ctx.sessionId) });
  return outcome;
}

async function thenValid(ctx, label) {
  const cmd = await publish(ctx.session, 'managed-tool-args', { command: 'true' }).catch((e) => null);
  const r = await attempt(ctx, `${label}: then a valid unrelated commit`, () =>
    cmd ? commitChild(ctx.session, ctx.sessionKey, 'shell-ok:admit', child({ shellId: 'shell-ok', commandRef: cmd, run: { executionCallId: 'call-ok' } })) : Promise.reject(new Error('publish failed')),
  );
  return r;
}

const ghostRefs = {
  cmd: ghost('ghost-args', 'managed-tool-args'),
  receipt: ghost('ghost-receipt', 'managed-runtime-receipt'),
  manifest: ghost('ghost-manifest', 'managed-tool-result-manifest'),
};
const chain = (id, refs) => {
  const S = (run, extra = {}) => child({ shellId: id, commandRef: refs.cmd, ...extra, run: { executionCallId: `call-${id}`, ...run } });
  return [
    ['admit', S({})],
    ['dispatch', S({ state: 'running', execution: 'dispatch_started', runtime: BINDING_1 })],
    ['attach', S({ state: 'running', execution: 'running_attached', runtime: BINDING_1 }, { startReceiptRef: refs.receipt })],
    ['output', S({ state: 'running', execution: 'running_attached', runtime: BINDING_1 }, { startReceiptRef: refs.receipt, outputRef: refs.manifest })],
  ];
};

const CASES = (process.env.CASES ?? 'ABCDE').split('');
// A
if (CASES.includes('A')) {
  const ctx = await fresh('A');
  const first = await attempt(ctx, 'A child_run admit, ghost commandRef', () => commitChild(ctx.session, ctx.sessionKey, 'shell-ghost:admit', chain('shell-ghost', ghostRefs)[0][1]));
  out.A = { first, next: await thenValid(ctx, 'A') };
  await ctx.session.close().catch(() => {});
}
// B
if (CASES.includes('B')) {
  const other = await createPublicSession();
  const o = await openSession({ sessionId: other.id, writerId: 'writer-other', create: true });
  const foreign = { cmd: await publish(o.session, 'managed-tool-args', { command: 'cat secrets', cwd: '/' }) };
  await o.session.close();
  const ctx = await fresh('B');
  const first = await attempt(ctx, 'B child_run admit, commandRef of another Session', () => commitChild(ctx.session, ctx.sessionKey, 'shell-foreign:admit', chain('shell-foreign', foreign)[0][1]));
  out.B = { first, next: await thenValid(ctx, 'B') };
  await ctx.session.close().catch(() => {});
}
// C
if (CASES.includes('C')) {
  const ctx = await fresh('C');
  const commitMcp = (id, domain, record) => ctx.session.authority.commitExtensionRecord(command(ctx.sessionKey, id, record, 'commitMcp'), { domain, record }, { class: 'trusted_entry' });
  await attempt(ctx, 'C mcp_configuration admit (no refs)', () => commitMcp('cfg:1', 'mcp_configuration', MCP.mcp_configuration));
  const op = { ...MCP.mcp_operation, argsRef: ghost('ghost-mcp-args', 'mcp-args') };
  const first = await attempt(ctx, 'C mcp_operation admit, ghost argsRef', () => commitMcp('op:1', 'mcp_operation', op));
  out.C = { first, next: await thenValid(ctx, 'C') };
  await ctx.session.close().catch(() => {});
}
// D
if (CASES.includes('D')) {
  const ctx = await fresh('D', { omitGhosts: true });
  // The authority's local check reads nothing for child_run, so only the
  // store can notice. Commit a full chain.
  const results = [];
  for (const [label, body] of chain('shell-ghost', ghostRefs)) {
    results.push(`${label}:${await attempt(ctx, `D child_run ${label}, ghost refs omitted from the commit`, () => commitChild(ctx.session, ctx.sessionKey, `shell-ghost:${label}`, body))}`);
  }
  const rows = javaRows(ctx.sessionId);
  say('D java rows', rows.map((r) => `${r[0]} ${r[3]} ${r[4]} rev${r[2]}`));
  out.D = { results, javaRows: rows.map((r) => `${r[0]} ${r[4]} rev${r[2]}`) };
  // A reader of that body later
  const rec = ctx.session.authority.extensionRecord('child_run', 'shell-ghost');
  for (const field of ['commandRef', 'startReceiptRef', 'outputRef']) {
    const ref = rec?.record?.[field];
    if (!ref) continue;
    try {
      await ctx.session.resources.read(ref);
      say(`D read ${field}`, 'OK');
    } catch (e) {
      say(`D read ${field}`, `${e.name}: ${e.message.slice(0, 140)}`);
    }
  }
  await ctx.session.close().catch(() => {});
  let reopen;
  try {
    const b = await openSession({ sessionId: ctx.sessionId, writerId: 'writer-D2' });
    reopen = `opened; views=${b.session.authority.taskViews().map((v) => `${v.kind} ${v.state}`).join(', ')}`;
    await b.session.close();
  } catch (e) {
    reopen = `${e.name}: ${e.message.slice(0, 200)}`;
  }
  say('D cold reopen by a second writer', reopen);
  out.D.reopen = reopen;
}
// E
if (CASES.includes('E')) {
  const ctx = await fresh('E', { omitGhosts: true });
  const commitMcp = (id, domain, record) => ctx.session.authority.commitExtensionRecord(command(ctx.sessionKey, id, record, 'commitMcp'), { domain, record }, { class: 'trusted_entry' });
  await attempt(ctx, 'E mcp_configuration admit (no refs)', () => commitMcp('cfg:1', 'mcp_configuration', MCP.mcp_configuration));
  // Skip the authority's local read so only the store judges.
  ctx.session.authority.verifyExtensionResources = async () => {};
  ctx.session.authority.assertExtensionRevision = () => {};
  const op = { ...MCP.mcp_operation, argsRef: ghost('ghost-mcp-args', 'mcp-args') };
  out.E = { first: await attempt(ctx, 'E mcp_operation admit, ghost argsRef omitted from the commit', () => commitMcp('op:1', 'mcp_operation', op)) };
  await ctx.session.close().catch(() => {});
}
// D2: as D, but with the authority's local checks off, so only the Java store judges child_run.
if (CASES.includes('F')) {
  const ctx = await fresh('D2', { omitGhosts: true });
  ctx.session.authority.verifyExtensionResources = async () => {};
  const results = [];
  for (const [label, body] of chain('shell-ghost', ghostRefs)) {
    results.push(`${label}:${await attempt(ctx, `D2 child_run ${label}, ghost refs omitted, local read off`, () => commitChild(ctx.session, ctx.sessionKey, `shell-ghost:${label}`, body))}`);
    if (!results.at(-1).includes('COMMITTED')) break;
  }
  out.D2 = { results, javaRows: javaRows(ctx.sessionId).map((r) => `${r[0]} ${r[4]} rev${r[2]}`) };
  say('D2 java rows', out.D2.javaRows);
  await ctx.session.close().catch(() => {});
}
// G: one ghost reference at a time (receipt, then output), real commandRef.
if (CASES.includes('G')) {
  for (const which of ['startReceiptRef', 'outputRef']) {
    const ctx = await fresh(`G-${which}`);
    const refs = {
      cmd: await publish(ctx.session, 'managed-tool-args', { command: 'sleep 9', cwd: '/workspace' }),
      receipt: which === 'startReceiptRef' ? ghost('ghost-receipt', 'managed-runtime-receipt') : await publish(ctx.session, 'managed-runtime-receipt', { unit: 'g.scope' }),
      manifest: which === 'outputRef' ? ghost('ghost-manifest', 'managed-tool-result-manifest') : await publish(ctx.session, 'managed-tool-result-manifest', { pages: 1 }),
    };
    const results = [];
    for (const [label, body] of chain('shell-g', refs)) {
      results.push(`${label}:${await attempt(ctx, `G ghost ${which}: ${label}`, () => commitChild(ctx.session, ctx.sessionKey, `shell-g:${label}`, body))}`);
      if (!results.at(-1).includes('COMMITTED')) break;
    }
    out[`G_${which}`] = { results, next: await thenValid(ctx, `G ${which}`) };
    await ctx.session.close().catch(() => {});
  }
}
say('RESULT', out);
