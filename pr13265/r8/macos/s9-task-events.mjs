// S9 (round 6): child_run and monitor_run lifecycles through the PR's hosted
// funnels into Spring + MySQL, then (a) the forward-only output rule of
// 36cbe1ca73 and (b) the task events routes of d17163b43d: public GET
// /tasks/{taskId}/events and the Web Shell query, paged, bounded, scoped.
// MODE=drive  creates the Session and prints its id; MODE=read SESSION=…
// only reads the routes (used again after a Spring restart).
import fs from 'node:fs';
import {
  BINDING_1, WT, api, createPublicSession, javaRows, openLog, openSession, records, say, TENANT,
} from './lib.mjs';

for (const domain of ['child_run', 'monitor_run']) {
  if (!records.MANAGED_SESSION_ENABLED_DOMAINS.includes(domain)) records.MANAGED_SESSION_ENABLED_DOMAINS.push(domain);
}
const MODE = process.env.MODE ?? 'drive';
openLog(process.env.LOGNAME_S9 ?? `s9-task-events-${MODE}`);
const out = {};
const pubManifest = (session, value) => session.resources.publish('managed-tool-result-manifest', Buffer.from(JSON.stringify(value), 'utf8'));
const attempt = async (fn) => { try { await fn(); return 'ok'; } catch (e) { return `REFUSED ${e.message.slice(0, 90)}`; } };

async function readEvents(sessionId, taskId, { limit = 2, tenant, actor = 'alice' } = {}) {
  const events = [];
  let after;
  for (let page = 0; page < 50; page++) {
    const q = new URLSearchParams({ limit: String(limit), ...(after ? { after } : {}) });
    const r = await api('GET', `/v1/agents/sessions/${sessionId}/tasks/${encodeURIComponent(taskId)}/events?${q}`, { actor, ...(tenant ? { tenant } : {}) });
    if (r.status !== 200) return { status: r.status, code: r.json?.error?.code ?? r.json?.code ?? r.text.slice(0, 80), events };
    events.push(...r.json.data);
    if (!r.json.has_more) break;
    after = r.json.next_cursor ?? r.json.data.at(-1)?.cursor;
  }
  return { status: 200, events };
}

let sessionId = process.env.SESSION;
if (MODE === 'drive') {
  const { HostedChildRunSession } = await import(`${WT}/packages/cli/dist/src/serve/hosted-child-run-session.js`);
  const { HostedMonitorSession } = await import(`${WT}/packages/cli/dist/src/serve/hosted-monitor-session.js`);
  const pub = await createPublicSession();
  sessionId = pub.id;
  const { session, sessionKey } = await openSession({ sessionId, writerId: 'writer-s9', create: true });
  const store = { authority: session.authority, resources: session.resources };
  const shells = new HostedChildRunSession(store, sessionKey);
  const monitors = new HostedMonitorSession(store, sessionKey);
  const a1 = await pubManifest(session, { revision: 1, captureId: 'cap-a' });
  const a2 = await pubManifest(session, { revision: 2, captureId: 'cap-a' });
  const b5 = await pubManifest(session, { revision: 5, captureId: 'cap-b-another-shell' });
  const c1 = await pubManifest(session, { revision: 1, captureId: 'cap-c' });

  // (a) forward-only output on both funnels
  const forward = {};
  await shells.admit({ shellId: 'h-1', ownerScopeId: 'scope', executionCallId: 'call-h1', args: { command: 'npm run dev', is_background: true } });
  await shells.dispatchStarted('h-1', BINDING_1);
  await shells.attach('h-1', BINDING_1, { unit: 'qwen-bg-call-h1' });
  forward.shell = {
    'advance(a1)': await attempt(() => shells.advanceOutput('h-1', a1)),
    'advance(a1) again — a replayed forward': await attempt(() => shells.advanceOutput('h-1', a1)),
    'advance(a2)': await attempt(() => shells.advanceOutput('h-1', a2)),
    'advance(a1) — regression': await attempt(() => shells.advanceOutput('h-1', a1)),
    'advance(b5) — another capture': await attempt(() => shells.advanceOutput('h-1', b5)),
    'settleExited(0)': await attempt(() => shells.settleExited('h-1', { exitCode: 0, exitSignal: null })),
    'advance(b5) again after settle — replay on a terminal record': await attempt(() => shells.advanceOutput('h-1', b5)),
  };
  forward.shellAfterSettle = (() => { const r = session.authority.extensionRecord('child_run', 'h-1'); return `rev${r.revision} ${r.task.state}/${r.task.runtimeState}`; })();
  await monitors.admit({ monitorId: 'm-1', ownerScopeId: 'scope', executionCallId: 'call-m1', args: { command: 'tail -f build.log' }, maxEvents: 3, idleTimeoutMs: 60_000, debounceMs: 1000 });
  await monitors.dispatchStarted('m-1', BINDING_1);
  await monitors.attach('m-1', BINDING_1, { watch: 'started' });
  forward.monitor = {
    'observe(1)': await attempt(() => monitors.observe('m-1', { lines: 1 })),
    'advance(c1)': await attempt(() => monitors.advanceOutput('m-1', c1)),
    'advance(c1) again — a replayed forward': await attempt(() => monitors.advanceOutput('m-1', c1)),
    'advance(b5) — another capture': await attempt(() => monitors.advanceOutput('m-1', b5)),
    'observe(2)': await attempt(() => monitors.observe('m-1', { lines: 2 })),
    'settleQuiet(idle_timeout)': await attempt(() => monitors.settleQuiet('m-1', 'idle_timeout')),
  };
  out.forward = forward;
  say('forward-only output', forward);
  out.revisions = Object.fromEntries(javaRows(sessionId).map((r) => [r[0], Number(r[2])]));
  await session.close();
}

// (b) task events routes
const list = await api('GET', `/v1/agents/sessions/${sessionId}/tasks?limit=20`, { actor: 'alice' });
const tasks = (list.json.data ?? []).map((t) => ({ id: t.id, kind: t.kind, state: t.state }));
out.tasks = tasks;
out.events = {};
for (const t of tasks) {
  const r = await readEvents(sessionId, t.id, { limit: 2 });
  out.events[t.id] = {
    status: r.status,
    count: r.events.length,
    types: r.events.map((e) => `${e.type}:${e.state ?? '-'}/${e.runtime_state ?? '-'}`),
    cursorsUnique: new Set(r.events.map((e) => e.cursor)).size === r.events.length,
    allLimit100: (await readEvents(sessionId, t.id, { limit: 100 })).events.length,
  };
}
const first = tasks[0]?.id;
if (first) {
  const probe = async (q, opts = {}) => { const r = await api('GET', `/v1/agents/sessions/${sessionId}/tasks/${encodeURIComponent(first)}/events?${q}`, { actor: 'alice', ...opts }); return `${r.status} ${r.json?.error?.code ?? r.json?.code ?? ''}`.trim(); };
  out.bounds = {
    'limit=0': await probe('limit=0'),
    'limit=101': await probe('limit=101'),
    'after=garbage': await probe('after=%%%garbage'),
    'other tenant': await probe('limit=5', { tenant: 't-other' }),
    'other actor': await probe('limit=5', { actor: 'mallory' }),
    'unknown task': `${(await api('GET', `/v1/agents/sessions/${sessionId}/tasks/no-such-task/events`, { actor: 'alice' })).status}`,
  };
  const ws = await api('POST', '/api/agent/web-shell/v1/tasks/events/query', { actor: 'alice', body: { sessionId, taskId: first, limit: 100 } });
  out.webShell = { status: ws.status, count: ws.json?.data?.length ?? null, sameAsPublic: JSON.stringify((ws.json?.data ?? []).map((e) => e.cursor)) === JSON.stringify((await readEvents(sessionId, first, { limit: 100 })).events.map((e) => e.cursor)) };
}
out.sessionId = sessionId;
fs.writeFileSync(`${process.env.OUT_JSON ?? '/dev/null'}`, JSON.stringify(out, null, 2));
say('RESULT', out);
process.exit(0);
