// S10/S11 (round 7) on the real HTTP store + Spring + MySQL.
// S10 — 5969410e47: a background Shell whose output advances 600 times
//       (each a state flip, so each a task event) — do record commits keep
//       landing past the journal's 512 bound, and what do the routes show?
// S11 — 375082f8ef: a Monitor with 110 observations, then one carrying a
//       notification: a bounded readEvents() vs the full committed range,
//       and settlePendingMonitorInputs on the HTTP-store authority.
import fs from 'node:fs';
import {
  BINDING_1, WT, api, createPublicSession, javaRows, openLog, openSession, records, say, sql, DB, TENANT,
} from './lib.mjs';

for (const domain of ['child_run', 'monitor_run']) {
  if (!records.MANAGED_SESSION_ENABLED_DOMAINS.includes(domain)) records.MANAGED_SESSION_ENABLED_DOMAINS.push(domain);
}
openLog('s10-s11');
const { HostedChildRunSession } = await import(`${WT}/packages/cli/dist/src/serve/hosted-child-run-session.js`);
const { HostedMonitorSession } = await import(`${WT}/packages/cli/dist/src/serve/hosted-monitor-session.js`);
const { settlePendingMonitorInputs } = await import(`${WT}/packages/cli/dist/src/serve/hosted-monitor-wake.js`);
const { pendingSessionInputs } = await import(`${WT}/packages/cli/dist/src/serve/hosted-wake-intake.js`);
const out = {};
const pub = await createPublicSession();
const sessionId = pub.id;
const { session, sessionKey } = await openSession({ sessionId, writerId: 'writer-s10', create: true });
const store = { authority: session.authority, resources: session.resources };

// ---- S10 ----
const shells = new HostedChildRunSession(store, sessionKey);
await shells.admit({ shellId: 'h-big', ownerScopeId: 'scope', executionCallId: 'call-hbig', args: { command: 'yes', is_background: true } });
await shells.dispatchStarted('h-big', BINDING_1);
await shells.attach('h-big', BINDING_1, { unit: 'qwen-bg-call-hbig' });
const ADV = Number(process.env.ADVANCES ?? 600);
let ok = 0, failed = 0, firstFailure = null;
const t0 = Date.now();
for (let i = 1; i <= ADV; i++) {
  const m = await session.resources.publish('managed-tool-result-manifest', Buffer.from(JSON.stringify({ revision: i, captureId: 'cap-big' })));
  try { await shells.advanceOutput('h-big', m); ok++; } catch (e) { failed++; firstFailure ??= `${i}: ${e.message.slice(0, 120)}`; }
}
const settle = await shells.settleExited('h-big', { exitCode: 0, exitSignal: null }).then(() => 'ok', (e) => `REFUSED ${e.message.slice(0, 120)}`);
const row = javaRows(sessionId).find((r) => r[0] === 'h-big');
const list = await api('GET', `/v1/agents/sessions/${sessionId}/tasks?limit=20`, { actor: 'alice' });
const task = (list.json.data ?? []).find((t) => t.kind === 'background_shell');
let events = 0, pages = 0, after, last;
for (; pages < 50; pages++) {
  const q = new URLSearchParams({ limit: '100', ...(after ? { after } : {}) });
  const r = await api('GET', `/v1/agents/sessions/${sessionId}/tasks/${task.id}/events?${q}`, { actor: 'alice' });
  if (r.status !== 200) { last = `${r.status} ${r.text.slice(0, 120)}`; break; }
  events += r.json.data.length;
  last = r.json.data.at(-1) ? `${r.json.data.at(-1).type}:${r.json.data.at(-1).state}` : last;
  if (!r.json.has_more) break;
  after = r.json.next_cursor;
}
const journalRows = Number(sql(`SELECT COUNT(*) FROM qwen_managed_session_task_journal WHERE tenant_id='${TENANT}' AND session_id='${sessionId}'`, DB)[0]?.[0] ?? -1);
out.s10 = { advances: ADV, committed: ok, failed, firstFailure, settle, javaRevision: Number(row?.[2]), javaState: row?.[4], taskState: task?.state, eventsServed: events, lastEvent: last, journalRows, ms: Date.now() - t0 };
say('S10', out.s10);

// ---- S11 ----
const monitors = new HostedMonitorSession(store, sessionKey);
await monitors.admit({ monitorId: 'm-wake', ownerScopeId: 'scope', executionCallId: 'call-mwake', args: { command: 'tail -f x' }, maxEvents: 1000, idleTimeoutMs: 600000, debounceMs: 1000 });
await monitors.dispatchStarted('m-wake', BINDING_1);
await monitors.attach('m-wake', BINDING_1, { watch: 'started' });
for (let i = 1; i <= 110; i++) await monitors.observe('m-wake', { lines: i });
const input = {
  inputId: 'm-wake:notify:111', turnId: 'm-wake:notify:111', source: 'monitor',
  contentRef: await session.resources.publish('managed-input', Buffer.from('{"text":"line 111"}')),
  deadline: null,
  admissionRef: await session.resources.publish('managed-admission', Buffer.from('{}')),
  wakeReason: 'input',
};
await monitors.observe('m-wake', { lines: 111 }, { input });
const a = session.authority;
const bounded = pendingSessionInputs(a.readEvents()).filter((x) => x.source === 'monitor').map((x) => x.turnId);
const full = pendingSessionInputs(a.eventsInSequenceRange(1, a.committedSequence)).filter((x) => x.source === 'monitor').map((x) => x.turnId);
const written = [];
const settled = await settlePendingMonitorInputs({ authority: a, sink: { write: async (r) => { written.push(r.systemPayload?.promptId); } }, sessionId, cwd: '/workspace' });
out.s11 = { committedSequence: a.committedSequence, readEventsLength: a.readEvents().length, pendingFromBoundedRead: bounded, pendingFromFullRange: full, settlePendingMonitorInputs: settled, settledTurnIds: written };
say('S11', out.s11);
await session.close();
// cold reopen from the store: does the full derivation still see it?
const b = await openSession({ sessionId, writerId: 'writer-s11b' });
const ba = b.session.authority;
out.s11.afterColdReopen = pendingSessionInputs(ba.eventsInSequenceRange(1, ba.committedSequence)).filter((x) => x.source === 'monitor').map((x) => x.turnId);
await b.session.close();
out.sessionId = sessionId;
fs.writeFileSync(process.env.OUT_JSON ?? '/dev/null', JSON.stringify(out, null, 2));
say('RESULT', out);
process.exit(0);
