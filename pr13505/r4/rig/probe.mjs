// VERIFICATION RIG ONLY (PR #13505): H4a child_agent / child_acceptance records on a real stack.
// The real TypeScript authority (core dist of the chosen arm, openManagedSession over
// createHttpManagedSessionStores) commits through a real Spring Managed Agent Server (Session
// Store) on MySQL 8.4.7. child_run / child_acceptance are enabled IN THIS PROCESS ONLY (the PR
// keeps them disabled for submission; this is the authority suite's own mock, done on dist).
// A second writer holding a valid writer token commits ONE crafted Stage H line over raw HTTP,
// which isolates the Java store's own commit-time checks; a fresh authority then reopens the
// Session exactly as the Hosted Harness does.
//
// usage: node probe.mjs <springBaseUrl> <arm> <coreDistSrc> <scenario|all> [resultsFile]
import { randomUUID, createHash } from 'node:crypto';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [base, arm, CORE, which, resultsFile] = process.argv.slice(2);
const { createHttpManagedSessionStores } = await import(`${CORE}/managed-runtime/http-managed-session-store.js`);
const { openManagedSession } = await import(`${CORE}/managed-runtime/managed-session-assembly.js`);
const { managedSessionEventsDigest, MANAGED_SESSION_LIMITS, MANAGED_SESSION_ENABLED_DOMAINS } = await import(
  `${CORE}/managed-runtime/managed-session-records.js`);
const { managedToolDigest } = await import(`${CORE}/tools/managed-tool-protocol.js`);

const TENANT = 'tenant-13505';
const WORKSPACE = 'ws-13505';
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const enable = () => {
  for (const d of ['child_run', 'child_acceptance'])
    if (!MANAGED_SESSION_ENABLED_DOMAINS.includes(d)) MANAGED_SESSION_ENABLED_DOMAINS.push(d);
};
const disable = () => {
  for (const d of ['child_run', 'child_acceptance']) {
    const i = MANAGED_SESSION_ENABLED_DOMAINS.indexOf(d);
    if (i >= 0) MANAGED_SESSION_ENABLED_DOMAINS.splice(i, 1);
  }
};

async function openFaithful(key, create) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'r13505-'));
  const stores = createHttpManagedSessionStores({
    baseUrl: base, sessionKey: key, writerId: `harness-${randomUUID().slice(0, 8)}`, leaseDurationMs: 5_000,
  });
  const refs = create ? {
    definitionRef: await stores.resourceStore.publish('managed-definition',
      Buffer.from(JSON.stringify({ engine: 'managed', sessionId: key.sessionId }))),
    rootSnapshotRef: await stores.resourceStore.publish('managed-root', Buffer.from(JSON.stringify({ cwd }))),
    createdBy: 'hosted-harness',
  } : undefined;
  return openManagedSession({
    runtimeBaseDir: cwd, transcriptPath: '', sessionId: key.sessionId, sessionKey: key, cwd,
    version: 'hosted-harness/1', workerId: 'probe-worker', activationLeaseDurationMs: 5_000,
    journalStore: stores.journalStore, resourceStore: stores.resourceStore,
    ...(refs ? { create: refs, requireNew: true } : { retainVerifiedResources: true }),
  });
}

async function http(key, token, p, method, body) {
  const url = `${base}/internal/managed-session-store/v1/sessions/${encodeURIComponent(key.sessionId)}${p}`;
  const res = await fetch(url, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json',
      'X-Qwen-Tenant-Id': key.tenantId, 'X-Qwen-Managed-Writer-Token': token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json };
}

function envelope(key, subtype, body, parentUuid) {
  return { uuid: randomUUID(), parentUuid, sessionId: key.sessionId, timestamp: new Date().toISOString(),
    type: 'system', subtype, cwd: '/workspace', version: 'rogue/1', managedSession: body };
}

// ---------- record builders (same shapes as managed-session-authority.child-agent.test.ts) ----------
const BINDING = { runtimeBindingId: 'binding-1', generation: '1' };
// Since 27ba5c26 a dispatched child_agent must pin its definition (R1-3); the
// faithful builders pin it from the first revision, as the PR's own suite does.
const DEF = { definitionId: 'agent-1', definitionRevision: 1, definitionDigest: 'f'.repeat(64) };
function runBlock(o) {
  return { state: 'admitted', reason: null, definition: process.env.NO_DEF ? null : DEF, executionCallId: 'call-agent-1', effectId: null,
    dispatchId: null, deliveryId: null, execution: 'intent', runtime: null,
    delivery: { target: 'session', state: 'planned' }, ...o };
}
function childAgent(refs, run, o = {}, key) {
  return { kind: 'child_agent', childRunId: 'run-1', ownerScopeId: 'scope-main', rootSessionId: key.sessionId,
    depth: 1, completion: 'sent', inputRef: refs.input, workspaceMode: 'shared', workingDirectory: '.',
    childSessionId: null, predecessorChildRunId: null, resultVersion: 1, resultRef: null, terminalReceiptRef: null,
    stopReason: null, stopRequested: false, run: runBlock(run), ...o };
}
function life(refs, key, o = {}) {
  const settled = { childSessionId: 'session-child', stopReason: 'completed', resultRef: refs.result, terminalReceiptRef: refs.receipt };
  const R = { dispatchId: 'dispatch-1', runtime: BINDING };
  return [
    childAgent(refs, {}, o, key),
    childAgent(refs, { state: 'running', execution: 'dispatch_started', ...R }, o, key),
    childAgent(refs, { state: 'running', execution: 'running_attached', ...R }, { childSessionId: 'session-child', ...o }, key),
    childAgent(refs, { state: 'settled', execution: 'settled', ...R, delivery: { target: 'session', state: 'accepting' } }, { ...settled, ...o }, key),
    childAgent(refs, { state: 'settled', execution: 'settled', ...R, delivery: { target: 'session', state: 'accepted' } }, { ...settled, ...o }, key),
    childAgent(refs, { state: 'settled', execution: 'settled', ...R, delivery: { target: 'session', state: 'consumed' } }, { ...settled, ...o }, key),
  ];
}
function acceptance(refs, state = 'accepted', o = {}) {
  return { childRunId: 'run-1', parentScopeId: 'scope-main', parentExecutionCallId: null, resultVersion: 1,
    contentRef: refs.result, contentDigest: refs.result.digest, terminalReceiptRef: refs.receipt,
    run: { state: 'settled', reason: null, definition: null, executionCallId: null, effectId: null, dispatchId: null,
      deliveryId: null, execution: null, runtime: null, delivery: { target: 'session', state } }, ...o };
}
const cmd = (key, commandId, operation = 'commitExtensionRecord') =>
  ({ operation, commandId, sessionKey: key, contentDigest: sha256(commandId) });
const TRUSTED = { class: 'trusted_entry' };

async function publishRefs(res) {
  return {
    input: await res.publish('managed-input', Buffer.from('{"prompt":"audit the diff"}')),
    result: await res.publish('managed-child-result', Buffer.from('{"summary":"clean"}')),
    receipt: await res.publish('managed-runtime-receipt', Buffer.from('{"outcome":"settled"}')),
    other: await res.publish('managed-child-result', Buffer.from('{"summary":"DIFFERENT"}')),
  };
}

// ---------- rogue writer: one Stage H line (domain.committed) with its body resource ----------
async function rogueStageH(key, domain, recordBody, ordinal, extraResources = []) {
  const token = `rogue${randomUUID().replaceAll('-', '')}`;
  const writerId = `rogue-${randomUUID().slice(0, 8)}`;
  const grant = await http(key, token, '/writers:acquire', 'POST', { workspaceId: WORKSPACE, writerId, leaseMillis: 30_000 });
  if (grant.status !== 200) throw new Error(`acquire ${grant.status} ${JSON.stringify(grant.json)}`);
  const g = grant.json;
  const seq = g.committedSequence + 1;
  const bytes0 = Buffer.from(typeof recordBody === 'string' ? recordBody : JSON.stringify(recordBody));
  const ref = { resourceId: `rogue-${domain}-${randomUUID()}`, kind: `managed-${domain}`, schemaVersion: 1, byteLength: bytes0.length, digest: sha256(bytes0) };
  const commandId = `rogue-${domain}-${randomUUID().slice(0, 8)}`;
  const event = { v: 1, sequence: seq, eventId: `${domain}:${ordinal}`, sessionKey: key, kind: 'domain.committed',
    occurredAt: Date.now(), payload: { domain, version: 1, operationId: commandId, recordRef: ref } };
  const rec = envelope(key, 'managed_session_event_v1', event, null);
  const eventsDigest = managedSessionEventsDigest([event]);
  const marker = { transactionId: randomUUID(), commandId, operation: 'rogue.append', contentDigest: sha256(commandId),
    firstSequence: seq, lastSequence: seq, eventCount: 1, eventsDigest, previousCommitDigest: g.lastCommitDigest };
  const commitDigest = managedToolDigest(marker, MANAGED_SESSION_LIMITS.maxCommitMarkerBytes);
  const records = [rec, envelope(key, 'managed_session_commit_v1', marker, rec.uuid)];
  const bytes = Buffer.from(records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const body = { workspaceId: WORKSPACE, writerId, writerGeneration: g.writerGeneration,
    expectedJournalRevision: g.journalRevision, expectedCommittedSequence: g.committedSequence,
    transactionId: marker.transactionId, operation: marker.operation, commandId, contentDigest: marker.contentDigest,
    firstSequence: seq, lastSequence: seq, eventCount: 1, eventsDigest, previousCommitDigest: g.lastCommitDigest,
    commitDigest, activationEpoch: g.activationEpoch, latestCheckpointResourceId: null, recordCount: records.length,
    recordBytesBase64: bytes.toString('base64'), recordDigest: sha256(bytes),
    resources: [[ref, bytes0], ...extraResources].map(([r, b]) => ({ ...r, bytesBase64: b.toString('base64') })) };
  const commit = await http(key, token, '/transactions:commit', 'POST', body);
  await http(key, token, '/writers:seal', 'POST', { workspaceId: WORKSPACE, writerId, writerGeneration: g.writerGeneration });
  return commit;
}

async function reopen(key) {
  try {
    const s = await openFaithful(key, false);
    const run = s.authority.extensionRecordsInDomain('child_run').map((r) => `${r.recordId}@${r.revision}`);
    const acc = s.authority.extensionRecordsInDomain('child_acceptance').map((r) => `${r.recordId}@${r.revision}`);
    const tasks = s.authority.taskViews().map((t) => `${t.kind}/${t.state}`);
    await s.close();
    return { status: 'OPENED', run, acc, tasks };
  } catch (e) {
    return { status: 'REFUSED', error: `${e.constructor.name}: ${e.message}`.slice(0, 300) };
  }
}

const results = [];
function result(scenario, fields) {
  const row = { arm, scenario, ...fields };
  results.push(row);
  console.log(JSON.stringify(row));
  if (resultsFile) appendFileSync(resultsFile, JSON.stringify(row) + '\n');
}
const newKey = (name) => ({ tenantId: TENANT, workspaceId: WORKSPACE, sessionId: `r13505-${name}-${randomUUID().slice(0, 8)}` });

// Creates a Session and commits `n` revisions of the faithful chain through the authority.
async function seeded(name, n, o = {}) {
  const key = newKey(name);
  const s = await openFaithful(key, true);
  const refs = await publishRefs(s.resources);
  enable();
  const chain = life(refs, key, o);
  for (let i = 0; i < n; i++)
    await s.authority.commitExtensionRecord(cmd(key, `run-1:${i + 1}`), { domain: 'child_run', record: chain[i] }, TRUSTED);
  await s.close();
  return { key, refs: { ...refs, committedResult: n >= 4 }, chain };
}

// A child that attached and then failed with no result (child_failed, delivery cancelled).
async function seededFailed(name) {
  const key = newKey(name);
  const s = await openFaithful(key, true);
  const refs = await publishRefs(s.resources);
  enable();
  const chain = life(refs, key).slice(0, 3);
  chain.push(childAgent(refs, { state: 'failed', execution: 'settled', dispatchId: 'dispatch-1', runtime: BINDING,
    delivery: { target: 'session', state: 'cancelled' } }, { childSessionId: 'session-child', stopReason: 'child_failed' }, key));
  for (let i = 0; i < chain.length; i++)
    await s.authority.commitExtensionRecord(cmd(key, `run-1:${i + 1}`), { domain: 'child_run', record: chain[i] }, TRUSTED);
  await s.close();
  return { key, refs: { ...refs, committedResult: false }, chain };
}

// A background Shell child_run (H3 kind) keyed shell-1, admitted.
async function seededShell(name) {
  const key = newKey(name);
  const s = await openFaithful(key, true);
  const refs = await publishRefs(s.resources);
  enable();
  const args = await s.resources.publish('managed-tool-args', Buffer.from('{"command":"sleep 1"}'));
  const shell = { kind: 'shell', shellId: 'shell-1', ownerScopeId: 'scope-main', commandRef: args, startReceiptRef: null,
    outputRef: null, stopReason: null, stopRequested: false, exitCode: null, exitSignal: null,
    run: { state: 'admitted', reason: null, definition: null, executionCallId: 'call-1', effectId: null, dispatchId: null,
      deliveryId: null, execution: 'intent', runtime: null, delivery: null } };
  await s.authority.commitExtensionRecord(cmd(key, 'shell-1:1'), { domain: 'child_run', record: shell }, TRUSTED);
  await s.close();
  return { key, refs: { ...refs, committedResult: false } };
}

const SCENARIOS = {
  // S0: the PR keeps both domains refused for submission (no in-process enablement).
  async 'disabled-refused'() {
    disable();
    const key = newKey('disabled');
    const s = await openFaithful(key, true);
    const refs = await publishRefs(s.resources);
    for (const [domain, record] of [['child_run', life(refs, key)[0]], ['child_acceptance', acceptance(refs)]]) {
      try {
        await s.authority.commitExtensionRecord(cmd(key, `${domain}-x`), { domain, record }, TRUSTED);
        result('disabled-refused', { domain, outcome: 'COMMITTED' });
      } catch (e) { result('disabled-refused', { domain, outcome: 'REFUSED', error: e.message.slice(0, 160) }); }
    }
    await s.close();
  },
  // S1: the whole faithful lifecycle through the real authority + real store, then a fresh reopen.
  async 'faithful-chain'() {
    const key = newKey('faithful');
    const s = await openFaithful(key, true);
    const refs = await publishRefs(s.resources);
    enable();
    const chain = life(refs, key);
    const views = [];
    for (let i = 0; i < 4; i++) {
      const r = await s.authority.commitExtensionRecord(cmd(key, `run-1:${i + 1}`), { domain: 'child_run', record: chain[i] }, TRUSTED);
      views.push({ rev: r.revision, seq: r.receipt.firstSequence, task: s.authority.taskViews().map((t) => `${t.kind}/${t.state}/${t.runtimeState}`).join(',') });
    }
    const a1 = await s.authority.commitExtensionRecord(cmd(key, 'accept-1:1', 'acceptChildResult'), { domain: 'child_acceptance', record: acceptance(refs) }, TRUSTED);
    views.push({ acc: a1.revision, taskId: a1.taskId, seq: a1.receipt.firstSequence });
    for (let i = 4; i < 6; i++) {
      const r = await s.authority.commitExtensionRecord(cmd(key, `run-1:${i + 1}`), { domain: 'child_run', record: chain[i] }, TRUSTED);
      views.push({ rev: r.revision, seq: r.receipt.firstSequence });
    }
    const a2 = await s.authority.commitExtensionRecord(cmd(key, 'accept-1:2', 'acceptChildResult'), { domain: 'child_acceptance', record: acceptance(refs, 'consumed') }, TRUSTED);
    views.push({ acc: a2.revision, seq: a2.receipt.firstSequence });
    // Command replay returns the original receipt.
    const replay = await s.authority.commitExtensionRecord(cmd(key, 'accept-1:1', 'acceptChildResult'), { domain: 'child_acceptance', record: acceptance(refs) }, TRUSTED);
    // Conflicting redelivery (different content digest) is refused.
    let redelivery;
    try {
      await s.authority.commitExtensionRecord(cmd(key, 'accept-1:3', 'acceptChildResult'),
        { domain: 'child_acceptance', record: acceptance(refs, 'consumed', { contentRef: refs.other, contentDigest: refs.other.digest }) }, TRUSTED);
      redelivery = 'COMMITTED';
    } catch (e) { redelivery = `REFUSED ${e.constructor.name}: ${e.message.slice(0, 120)}`; }
    await s.close();
    disable(); // the reopen reads committed records regardless of enablement
    const again = await reopen(key);
    result('faithful-chain', { sessionId: key.sessionId, views, replay: { rev: replay.revision, replayed: replay.receipt.replayed, seq: replay.receipt.firstSequence }, redelivery, reopen: again });
    writeFileSync(`/Users/wenshao/git/pr13505-rig/results/faithful-session-${arm}.txt`, key.sessionId);
  },
  // S2: the Java store's acceptance cross-record checks, isolated by a rogue writer.
  async 'java-cross-record'() {
    const cases = [
      ['control', 4, {}, (r) => acceptance(r)],
      ['missing-run', 4, {}, (r) => acceptance(r, 'accepted', { childRunId: 'run-404' })],
      ['unsettled-run', 3, {}, (r) => acceptance(r)],
      ['scope-mismatch', 4, {}, (r) => acceptance(r, 'accepted', { parentScopeId: 'scope-other' })],
      ['call-mismatch-sent', 4, {}, (r) => acceptance(r, 'accepted', { parentExecutionCallId: 'call-agent-1' })],
      ['call-missing-tool', 4, { completion: 'tool' }, (r) => acceptance(r, 'accepted', { parentExecutionCallId: null })],
      ['call-control-tool', 4, { completion: 'tool' }, (r) => acceptance(r, 'accepted', { parentExecutionCallId: 'call-agent-1' })],
      ['content-digest-mismatch', 4, {}, (r) => acceptance(r, 'accepted', { contentRef: r.other, contentDigest: r.other.digest })],
      ['receipt-mismatch', 4, {}, (r) => acceptance(r, 'accepted', { terminalReceiptRef: r.other })],
      ['opens-consumed', 4, {}, (r) => acceptance(r, 'consumed')],
    ];
    cases.push(['failed-run', 'failed', {}, (r) => acceptance(r)]);
    cases.push(['shell-run', 'shell', {}, (r) => acceptance(r, 'accepted', { childRunId: 'shell-1' })]);
    for (const [name, n, o, build] of cases) {
      const { key, refs } = n === 'failed' ? await seededFailed(`xr-${name}`) : n === 'shell' ? await seededShell(`xr-${name}`) : await seeded(`xr-${name}`, n, o);
      const body = build(refs);
      // Resources only staged by the faithful writer (never committed) ship with the rogue line,
      // so the store's own cross-record check is what answers, not the resource closure.
      const extra = [];
      const text = JSON.stringify(body);
      if (text.includes(refs.other.resourceId)) extra.push([refs.other, Buffer.from('{"summary":"DIFFERENT"}')]);
      if (!refs.committedResult) { extra.push([refs.result, Buffer.from('{"summary":"clean"}')]); extra.push([refs.receipt, Buffer.from('{"outcome":"settled"}')]); }
      const commit = await rogueStageH(key, 'child_acceptance', body, 1, extra);
      const again = await reopen(key);
      result('java-cross-record', { case: name, http: commit.status, code: commit.json?.code ?? commit.json?.error ?? null,
        message: (commit.json?.message ?? commit.json?.detail ?? '').slice(0, 140), reopen: again.status, acc: again.acc, err: again.error });
    }
  },
  // S3: identity fields the TS validator refuses but the Java validator never checks.
  async 'id-parity'() {
    const cases = [
      ['control', {}],
      ['ownerScopeId-control-char', { ownerScopeId: 'scope\u0001main' }],
      ['ownerScopeId-empty', { ownerScopeId: '' }],
      ['rootSessionId-NFD', { rootSessionId: 'café' }],
      ['rootSessionId-600B', { rootSessionId: 'r'.repeat(600) }],
      ['childRunId-control-char', { childRunId: 'run\u0007bell' }],
      ['childRunId-number', { childRunId: 42 }],
      ['childRunId-null', { childRunId: null }],
    ];
    for (const [name, o] of cases) {
      const key = newKey(`id-${name}`);
      const s = await openFaithful(key, true);
      const refs = await publishRefs(s.resources);
      if (name === 'control') {
        enable();
        let v;
        try { await s.authority.commitExtensionRecord(cmd(key, 'ctl'), { domain: 'child_run', record: life(refs, key)[0] }, TRUSTED); v = 'TS-ACCEPTED+COMMITTED'; }
        catch (e) { v = `TS-REFUSED: ${e.message.slice(0, 90)}`; }
        await s.close(); disable();
        const again = await reopen(key);
        result('id-parity', { case: name, ts: v, reopen: again.status, run: again.run, tasks: again.tasks });
        continue;
      }
      // Make `input` durable through a faithful commit the TS writer accepts: a shell-free path —
      // commit nothing; ship the input bytes with the rogue line instead.
      await s.close();
      const body = { ...life(refs, key)[0], ...o };
      // What the TS writer itself says about the body (it never sends it).
      enable();
      let tsVerdict;
      try {
        const t = await openFaithful(key, false);
        try { await t.authority.commitExtensionRecord(cmd(key, `ts-${name}`), { domain: 'child_run', record: body }, TRUSTED); tsVerdict = 'TS-ACCEPTED'; }
        catch (e) { tsVerdict = `TS-REFUSED: ${e.message.slice(0, 90)}`; }
        await t.close();
      } catch (e) { tsVerdict = `TS-OPEN-FAILED ${e.message.slice(0, 80)}`; }
      disable();
      if (name === 'control') { result('id-parity', { case: name, ts: tsVerdict, note: 'control committed by TS writer itself' });
        const again = await reopen(key); result('id-parity', { case: name + '-reopen', reopen: again.status, run: again.run, tasks: again.tasks }); continue; }
      const commit = await rogueStageH(key, 'child_run', body, 1, [[refs.input, Buffer.from('{"prompt":"audit the diff"}')]]);
      const again = await reopen(key);
      result('id-parity', { case: name, ts: tsVerdict, http: commit.status, code: commit.json?.code ?? commit.json?.error ?? null,
        message: (commit.json?.message ?? '').slice(0, 120), reopen: again.status, err: again.error });
    }
  },
  // One-directional binding: does the child_run delivery line consult the acceptance record?
  async 'delivery-vs-acceptance'() {
    const settledRun = (refs, key, state) => childAgent(refs, { state: 'settled', execution: 'settled', dispatchId: 'dispatch-1', runtime: BINDING,
      delivery: { target: 'session', state } }, { childSessionId: 'session-child', stopReason: 'completed', resultRef: refs.result, terminalReceiptRef: refs.receipt }, key);
    const cases = [
      // (a) delivery reaches consumed with no acceptance record at all
      ['consumed-without-acceptance', false, ['accepted', 'consumed']],
      // (b) an acceptance exists (accepted), then the run's delivery is marked rejected
      ['rejected-after-acceptance', true, ['rejected']],
      // (c) an acceptance exists, then the run's delivery goes unknown
      ['unknown-after-acceptance', true, ['unknown']],
    ];
    for (const [name, withAcceptance, states] of cases) {
      const key = newKey(`dva-${name}`);
      const s = await openFaithful(key, true);
      const refs = await publishRefs(s.resources);
      enable();
      const chain = life(refs, key);
      for (let i = 0; i < 4; i++)
        await s.authority.commitExtensionRecord(cmd(key, `run-1:${i + 1}`), { domain: 'child_run', record: chain[i] }, TRUSTED);
      if (withAcceptance)
        await s.authority.commitExtensionRecord(cmd(key, 'accept-1:1', 'acceptChildResult'), { domain: 'child_acceptance', record: acceptance(refs) }, TRUSTED);
      const steps = [];
      let n = 5;
      for (const st of states) {
        try { const r = await s.authority.commitExtensionRecord(cmd(key, `run-1:${n++}`), { domain: 'child_run', record: settledRun(refs, key, st) }, TRUSTED); steps.push(`${st}:COMMITTED@${r.revision}`); }
        catch (e) { steps.push(`${st}:REFUSED ${e.message.slice(0, 80)}`); }
      }
      await s.close(); disable();
      const again = await reopen(key);
      result('delivery-vs-acceptance', { case: name, withAcceptance, steps, reopen: again.status, run: again.run, acc: again.acc });
    }
  },
  // Resource closure of a child_agent settle revision's result/receipt (round 2, J7b).
  async 'settle-closure'() {
    for (const [name, field] of [['result-unheld', 'resultRef'], ['receipt-unheld', 'terminalReceiptRef'], ['control', null]]) {
      const { key, refs, chain } = await seeded(`sc-${name}`, 3);
      const settled = structuredClone(life(refs, key)[3]);
      const ghost = { ...refs.result, resourceId: `never-shipped-${name}` };
      if (field) settled[field] = field === 'resultRef' ? ghost : { ...refs.receipt, resourceId: `never-shipped-${name}` };
      const ship = [];
      if (field !== 'resultRef') ship.push([refs.result, Buffer.from('{"summary":"clean"}')]);
      if (field !== 'terminalReceiptRef') ship.push([refs.receipt, Buffer.from('{"outcome":"settled"}')]);
      const commit = await rogueStageH(key, 'child_run', settled, 4, ship);
      const again = await reopen(key);
      const c = commit.json?.code ?? commit.json?.error;
      result('settle-closure', { case: name, http: commit.status, code: typeof c === 'object' ? c?.code : c, message: (typeof c === 'object' ? c?.message : '') ?? '', reopen: again.status, run: again.run });
    }
  },
  // Non-finite number in a body, sent as raw text (round 3, reviewer P2 on decimalValue()).
  async 'nonfinite'() {
    for (const [name, domain, build] of [
      ['child_run-resultVersion-1e400', 'child_run', (refs, key) => JSON.stringify(life(refs, key)[0]).replace('"resultVersion":1', '"resultVersion":1e400')],
      ['child_acceptance-resultVersion-1e400', 'child_acceptance', (refs) => JSON.stringify(acceptance(refs)).replace('"resultVersion":1', '"resultVersion":1e400')],
    ]) {
      const { key, refs } = await seeded(`nf-${name}`, domain === 'child_acceptance' ? 4 : 0);
      const text = build(refs, key);
      if (!text.includes('1e400')) throw new Error('raw number not injected');
      const ship = domain === 'child_run' ? [[refs.input, Buffer.from('{"prompt":"audit the diff"}')]] : [];
      const commit = await rogueStageH(key, domain, text, 1, ship);
      const again = await reopen(key);
      const c = commit.json?.code ?? commit.json?.error;
      result('nonfinite', { case: name, http: commit.status, code: typeof c === 'object' ? c?.code : c, message: (typeof c === 'object' ? c?.message : '') ?? '', reopen: again.status });
    }
  },
  // First-level child: rootSessionId must be this Session (round 4 rule, both sides).
  async 'root-binding'() {
    // (a) the TS writer itself
    for (const [name, o] of [['ts-depth1-foreign-root', { rootSessionId: 'someone-else' }], ['ts-depth2-foreign-root', { depth: 2, rootSessionId: 'someone-else' }], ['ts-depth1-own-root', {}]]) {
      const key = newKey(`rb-${name}`);
      const s = await openFaithful(key, true);
      const refs = await publishRefs(s.resources);
      enable();
      let v;
      try { await s.authority.commitExtensionRecord(cmd(key, 'run-1:1'), { domain: 'child_run', record: life(refs, key, o)[0] }, TRUSTED); v = 'COMMITTED'; }
      catch (e) { v = `REFUSED ${e.message.slice(0, 100)}`; }
      await s.close(); disable();
      result('root-binding', { case: name, path: 'ts-authority', outcome: v });
    }
    // (b) the Java store alone, via the raw-HTTP writer
    for (const [name, o] of [['java-depth1-foreign-root', { rootSessionId: 'someone-else' }], ['java-depth2-foreign-root', { depth: 2, rootSessionId: 'someone-else' }], ['java-depth1-own-root', {}]]) {
      const key = newKey(`rb-${name}`);
      const s = await openFaithful(key, true);
      const refs = await publishRefs(s.resources);
      await s.close();
      const commit = await rogueStageH(key, 'child_run', life(refs, key, o)[0], 1, [[refs.input, Buffer.from('{"prompt":"audit the diff"}')]]);
      const again = await reopen(key);
      const c = commit.json?.code ?? commit.json?.error;
      result('root-binding', { case: name, path: 'raw-http', http: commit.status, code: typeof c === 'object' ? c?.code : c, message: (typeof c === 'object' ? c?.message : '') ?? '', reopen: again.status, err: again.error });
    }
  },
  // Round-4 guards on a real chain, each the only reason for refusal.
  async 'r4-guards'() {
    const B = { runtimeBindingId: 'binding-1', generation: '1' };
    const cases = [
      // rev1 admitted with no pin (legal), rev2 dispatches with no pin
      ['definition-at-dispatch', (refs, key) => {
        const a = childAgent(refs, { definition: null }, {}, key);
        const b = childAgent(refs, { definition: null, state: 'running', execution: 'dispatch_started', dispatchId: 'dispatch-1', runtime: B }, {}, key);
        return [[a], b];
      }],
      // rev1 admitted, rev2 dispatched with no runtime (legal), rev3 attaches a Session with no runtime
      ['runtime-for-attached-session', (refs, key) => {
        const a = childAgent(refs, {}, {}, key);
        const b = childAgent(refs, { state: 'running', execution: 'dispatch_started', dispatchId: 'dispatch-1', runtime: null }, {}, key);
        const c = childAgent(refs, { state: 'running', execution: 'running_attached', dispatchId: 'dispatch-1', runtime: null }, { childSessionId: 'session-child' }, key);
        return [[a, b], c];
      }],
      // rev1 itself carries a drive-qualified workingDirectory
      ['drive-working-directory', (refs, key) => [[], childAgent(refs, {}, { workingDirectory: 'C:/outside' }, key)]],
    ];
    for (const [name, build] of cases) {
      for (const path of ['ts-authority', 'raw-http']) {
        const key = newKey(`g4-${name}-${path}`);
        const s = await openFaithful(key, true);
        const refs = await publishRefs(s.resources);
        enable();
        const [prefix, bad] = build(refs, key);
        for (let i = 0; i < prefix.length; i++)
          await s.authority.commitExtensionRecord(cmd(key, `run-1:${i + 1}`), { domain: 'child_run', record: prefix[i] }, TRUSTED);
        let row;
        if (path === 'ts-authority') {
          try { await s.authority.commitExtensionRecord(cmd(key, `run-1:${prefix.length + 1}`), { domain: 'child_run', record: bad }, TRUSTED); row = { outcome: 'COMMITTED' }; }
          catch (e) { row = { outcome: `REFUSED ${e.message.slice(0, 100)}` }; }
          await s.close();
        } else {
          await s.close();
          const ship = prefix.length === 0 ? [[refs.input, Buffer.from('{"prompt":"audit the diff"}')]] : [];
          const commit = await rogueStageH(key, 'child_run', bad, prefix.length + 1, ship);
          const c = commit.json?.code ?? commit.json?.error;
          row = { http: commit.status, code: typeof c === 'object' ? c?.code : c, message: (typeof c === 'object' ? c?.message : '') ?? '' };
        }
        disable();
        const again = await reopen(key);
        result('r4-guards', { case: name, path, ...row, reopen: again.status, run: again.run });
      }
    }
  },
  // Reopen an existing Session (SESSION env) with this arm's authority: old-reader / downgrade checks.
  async 'reopen-only'() {
    const key = { tenantId: TENANT, workspaceId: WORKSPACE, sessionId: process.env.SESSION };
    const again = await reopen(key);
    result('reopen-only', { sessionId: key.sessionId, ...again });
  },
  // H3 Shell chain written by this arm (child_run enabled in-process), for the upgrade check.
  async 'shell-seed'() {
    const key = newKey('shell-upgrade');
    const s = await openFaithful(key, true);
    enable();
    const args = await s.resources.publish('managed-tool-args', Buffer.from('{"command":"sleep 1"}'));
    const shell = (run, o = {}) => ({ kind: 'shell', shellId: 'shell-1', ownerScopeId: 'scope-main', commandRef: args,
      startReceiptRef: null, outputRef: null, stopReason: null, stopRequested: false, exitCode: null, exitSignal: null,
      run: { state: 'admitted', reason: null, definition: null, executionCallId: 'call-1', effectId: null, dispatchId: null,
        deliveryId: null, execution: 'intent', runtime: null, delivery: null, ...run }, ...o });
    const r1 = await s.authority.commitExtensionRecord(cmd(key, 'shell-1:1'), { domain: 'child_run', record: shell({}) }, TRUSTED);
    const r2 = await s.authority.commitExtensionRecord(cmd(key, 'shell-1:2'), { domain: 'child_run',
      record: shell({ state: 'running', execution: 'dispatch_started', runtime: BINDING }) }, TRUSTED);
    const views = s.authority.taskViews().map((t) => `${t.kind}/${t.state}/${t.runtimeState}`);
    await s.close();
    writeFileSync(`/Users/wenshao/git/pr13505-rig/results/shell-session-${arm}.txt`, key.sessionId);
    writeFileSync(`/Users/wenshao/git/pr13505-rig/results/shell-args-${arm}.json`, JSON.stringify(args));
    result('shell-seed', { sessionId: key.sessionId, revs: [r1.revision, r2.revision], taskId: r2.taskId, views });
  },
  // Continue that Shell chain with this arm (after the upgrade): reopen, then commit revision 3.
  async 'shell-continue'() {
    const key = { tenantId: TENANT, workspaceId: WORKSPACE, sessionId: process.env.SESSION };
    const args = JSON.parse(process.env.ARGS);
    const s = await openFaithful(key, false);
    enable();
    const before = s.authority.taskViews().map((t) => `${t.taskId.slice(0, 16)}:${t.kind}/${t.state}/${t.runtimeState}`);
    const rec = { kind: 'shell', shellId: 'shell-1', ownerScopeId: 'scope-main', commandRef: args, startReceiptRef: null,
      outputRef: null, stopReason: null, stopRequested: true, exitCode: null, exitSignal: null,
      run: { state: 'running', reason: null, definition: null, executionCallId: 'call-1', effectId: null, dispatchId: null,
        deliveryId: null, execution: 'dispatch_started', runtime: BINDING, delivery: null } };
    let outcome;
    try { const r = await s.authority.commitExtensionRecord(cmd(key, 'shell-1:3'), { domain: 'child_run', record: rec }, TRUSTED); outcome = `COMMITTED rev ${r.revision}`; }
    catch (e) { outcome = `REFUSED ${e.message.slice(0, 160)}`; }
    const after = s.authority.taskViews().map((t) => `${t.taskId.slice(0, 16)}:${t.kind}/${t.state}/${t.runtimeState}`);
    await s.close();
    result('shell-continue', { sessionId: key.sessionId, before, outcome, after });
  },
};

const names = which === 'all' ? ['disabled-refused','faithful-chain','java-cross-record','id-parity'] : which.split(',');
for (const n of names) {
  try { await SCENARIOS[n](); }
  catch (e) { result(n, { outcome: 'PROBE-ERROR', error: `${e.constructor.name}: ${e.message}`.slice(0, 400), stack: e.stack?.split('\n').slice(1, 4).join(' | ') }); }
}
process.exit(0);
