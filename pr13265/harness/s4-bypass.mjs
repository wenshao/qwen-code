// S4: only the Java store judges. The authority's own revision check is
// switched off and, for bodies TypeScript cannot parse, the published
// managed-child_run bytes are swapped on the way out, so the real server
// receives exactly the candidate. Records the HTTP status of the commit and
// what the writer can still do afterwards.
import {
  BINDING_1, BINDING_2, ENABLED, child, commitChild, createPublicSession, javaRows,
  journalCounts, openLog, openSession, publish, recordingFetch, say,
} from './lib.mjs';

if (!ENABLED) throw new Error('S4 needs ENABLE_CHILD_RUN=1');
openLog(process.env.LOGNAME_S4 ?? 's4-bypass');
const out = {};

async function fresh(label) {
  const pub = await createPublicSession();
  const http = [];
  const { session, sessionKey } = await openSession({ sessionId: pub.id, writerId: `writer-${label}`, create: true, fetchFn: recordingFetch(http) });
  session.authority.assertExtensionRevision = () => {};
  const cmd = await publish(session, 'managed-tool-args', { command: 'sleep 600', cwd: '/workspace' });
  const receipt = await publish(session, 'managed-runtime-receipt', { unit: `${label}.scope` });
  return { sessionId: pub.id, session, sessionKey, http, cmd, receipt };
}

/** Commits `body`, but the server receives `wire` as the record's bytes. */
async function commitSwapped(ctx, commandId, body, wire) {
  const original = ctx.session.resources.publish.bind(ctx.session.resources);
  ctx.session.resources.publish = (kind, bytes, ...rest) =>
    original(kind, kind === 'managed-child_run' ? Buffer.from(JSON.stringify(wire), 'utf8') : bytes, ...rest);
  const mark = ctx.http.length;
  const before = journalCounts(ctx.sessionId);
  let outcome;
  try {
    const r = await commitChild(ctx.session, ctx.sessionKey, commandId, body);
    outcome = `committed rev${r.revision}`;
  } catch (e) {
    outcome = `${e.name}: ${e.message.slice(0, 200)}`;
  } finally {
    ctx.session.resources.publish = original;
  }
  const calls = ctx.http.slice(mark).map((c) => `${c.method} ${c.path} ${c.status}`);
  return { outcome, calls, before, after: journalCounts(ctx.sessionId) };
}

const S = (ctx, run, extra = {}) => child({ shellId: 'shell-1', commandRef: ctx.cmd, ...extra, run: { executionCallId: 'call-shell-1', ...run } });

// (1) exitSignal of the wrong JSON type vs an invalid string, on a terminal revision.
for (const [label, signal] of [['signal-number', 9], ['signal-bool', true], ['signal-lowercase', 'term']]) {
  const ctx = await fresh(label);
  await commitChild(ctx.session, ctx.sessionKey, 'shell-1:admit', S(ctx, {}));
  await commitChild(ctx.session, ctx.sessionKey, 'shell-1:dispatch', S(ctx, { state: 'running', execution: 'dispatch_started', runtime: BINDING_1 }));
  await commitChild(ctx.session, ctx.sessionKey, 'shell-1:attach', S(ctx, { state: 'running', execution: 'running_attached', runtime: BINDING_1 }, { startReceiptRef: ctx.receipt }));
  const valid = S(ctx, { state: 'settled', execution: 'settled', runtime: BINDING_1 }, { startReceiptRef: ctx.receipt, stopReason: 'exited', exitSignal: 'KILL' });
  const wire = { ...valid, exitSignal: signal };
  const r = await commitSwapped(ctx, 'shell-1:exit', valid, wire);
  say(label, r);
  // Can this writer still commit afterwards?
  let next;
  try {
    const n = await commitChild(ctx.session, ctx.sessionKey, 'shell-1:exit-retry', valid);
    next = `committed rev${n.revision}`;
  } catch (e) {
    next = `${e.name}: ${e.message.slice(0, 160)}`;
  }
  say(`${label} then a valid commit`, next);
  out[label] = { status: r.calls.filter((c) => c.includes('/journal')).join(' | '), outcome: r.outcome, next, javaRow: javaRows(ctx.sessionId).map((x) => `${x[4]} rev${x[2]}`).join(',') };
  await ctx.session.close().catch((e) => say(`${label} close`, `${e.name}: ${e.message.slice(0, 120)}`));
}

// (2) re-attach of the same process under a later generation, same receipt (Java only).
{
  const ctx = await fresh('reattach');
  await commitChild(ctx.session, ctx.sessionKey, 'shell-1:admit', S(ctx, {}));
  await commitChild(ctx.session, ctx.sessionKey, 'shell-1:dispatch', S(ctx, { state: 'running', execution: 'dispatch_started', runtime: BINDING_1 }));
  await commitChild(ctx.session, ctx.sessionKey, 'shell-1:attach', S(ctx, { state: 'running', execution: 'running_attached', runtime: BINDING_1 }, { startReceiptRef: ctx.receipt }));
  await commitChild(ctx.session, ctx.sessionKey, 'shell-1:lost', S(ctx, { state: 'recovery_blocked', reason: 'runtime_lost', execution: 'outcome_unknown', runtime: BINDING_1 }, { startReceiptRef: ctx.receipt }));
  const same = S(ctx, { state: 'running', reason: 'runtime_lost', execution: 'running_attached', runtime: BINDING_2 }, { startReceiptRef: ctx.receipt });
  const r = await commitSwapped(ctx, 'shell-1:reattach-same', same, same);
  say('reattach-same-receipt (Java only)', r);
  out.reattachSameJava = { status: r.calls.filter((c) => c.includes('/journal')).join(' | '), outcome: r.outcome };
  await ctx.session.close().catch(() => {});
}
say('RESULT', out);
