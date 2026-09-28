// S14: records exist, then monitor_run is disabled again (as a rollback of
// the enablement would do). Retry replays, new commits are refused on every
// path, and a cold reopen still rebuilds the task list.
import { FIXTURES, RefMapper, api, commitMonitor, command, createPublicSession, javaRows, openLog, openSession, records, say } from './lib.mjs';
openLog(process.env.WT ? 'new-s14-disabled' : 's14-disabled');
const pub = await createPublicSession({ actor: 'alice' });
const sessionId = pub.id;
const a = await openSession({ sessionId, writerId: 'dis-a', create: true });
const refs = new RefMapper(a.session.resources);
const revs = await Promise.all(FIXTURES.monitorChainCases[0].revisions.map((r) => refs.remap(r.monitorRun)));
await commitMonitor(a.session, a.sessionKey, 'm:1', revs[0]);
await commitMonitor(a.session, a.sessionKey, 'm:2', revs[1]);
const views = a.session.authority.taskViews();
// disable the domain again, in this process
const list = records.MANAGED_SESSION_ENABLED_DOMAINS;
list.splice(list.indexOf('monitor_run'), 1);
const out = { enabled: [...list] };
const attempt = async (label, fn) => { try { const r = await fn(); out[label] = r; } catch (e) { out[label] = `${e.name}: ${String(e.message).slice(0, 110)}`; } };
await attempt('retrySameCommand', async () => { const r = await commitMonitor(a.session, a.sessionKey, 'm:2', revs[1]); return `replayed=${r.receipt.replayed} revision=${r.revision}`; });
await attempt('newRevision', async () => { const r = await commitMonitor(a.session, a.sessionKey, 'm:3', revs[2]); return `committed revision ${r.revision}`; });
await attempt('commitDomainRecordBypass', async () => { await a.session.authority.commitDomainRecord(command(a.sessionKey, 'bypass:1', {}), { domain: 'monitor_run', content: { x: 1 } }, { class: 'trusted_entry' }); return 'committed'; });
out.javaRowAfter = javaRows(sessionId).map((r) => r.slice(0, 3));
await a.session.close().catch((e) => (out.closeErr = String(e.message).slice(0, 80)));
await attempt('coldReopenDisabled', async () => { const b = await openSession({ sessionId, writerId: 'dis-b' }); const v = b.session.authority.taskViews(); await b.session.close(); return `opened; views equal=${JSON.stringify(v) === JSON.stringify(views)}`; });
const t = await api('GET', `/v1/agents/sessions/${sessionId}/tasks`, { actor: 'alice' });
out.publicTasks = t.json.data.map((x) => x.state);
say('disabled-after-records', out);
