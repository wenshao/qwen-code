// S11: a Monitor that ends settled -> task state completed, on the real stack.
import { FIXTURES, RefMapper, allEvents, api, commitMonitor, createPublicSession, javaRows, openLog, openSession, projection, say, tsViewAsRow } from './lib.mjs';
openLog('s11-completed');
const BODY = projection.MANAGED_EXTENSION_RECORD_BODIES.monitor_run;
const pub = await createPublicSession({ actor: 'alice' });
const { session, sessionKey } = await openSession({ sessionId: pub.id, writerId: 'done-a', create: true });
const refs = new RefMapper(session.resources);
const a = await Promise.all(FIXTURES.monitorChainCases[0].revisions.slice(0, 4).map((r) => refs.remap(r.monitorRun)));
const out = [];
for (let i = 0; i < 4; i++) { await commitMonitor(session, sessionKey, `m:${i + 1}`, a[i]); }
const tries = [];
for (const stopReason of ['exited', 'idle_timeout', 'max_events', 'watch_failed']) {
  for (const execution of ['settled']) {
    const next = { ...a[3], stopReason, notifiedThrough: 1, run: { ...a[3].run, state: 'settled', execution } };
    if (stopReason === 'max_events') next.observationSequence = next.maxEvents;
    let ok; try { BODY.parse(next); ok = BODY.isSuccessor(a[3], next); } catch (e) { ok = `parse: ${e.message.slice(0, 80)}`; }
    tries.push({ stopReason, ok });
    if (ok === true && !out.length) {
      await commitMonitor(session, sessionKey, 'm:5', next);
      const ts = tsViewAsRow(session.authority.extensionRecord('monitor_run', 'monitor-1'));
      const java = javaRows(pub.id)[0].slice(0, 10);
      out.push({ stopReason, ts, java, equal: JSON.stringify(ts) === JSON.stringify(java) });
    }
  }
}
const list = await api('GET', `/v1/agents/sessions/${pub.id}/tasks`, { actor: 'alice' });
const ev = (await allEvents(pub.id)).filter((e) => e.type === 'task.updated').map((e) => e.data.state);
await session.close();
say('completed', { tries, committed: out, publicTask: list.json.data[0], events: ev });
