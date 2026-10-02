// VERIFICATION RIG ONLY (PR #13194): what stays readable through L1 and what L2 hides, on both surfaces.
// usage: DB=<db> BASE=... RUNDIR=... node p7-reads.mjs <workspace> <storage-letter>
import {
  Report, api, createSession, waitTurn, ensureWorkspace, closeSession, opIdOf, waitOp, sessStatus, j, resourcesOf, lxWs,
  archive, unarchive, del, opId, waitFor,
} from './lib94.mjs';

const [WS = 'ws-rd', ST = 'v'] = process.argv.slice(2);
const rep = new Report(`p7-reads-${WS}`);
ensureWorkspace(WS, `st-${ST}`);
const K = (n) => `${n}-${Date.now().toString(36)}`;
const WEB = '/api/agent/web-shell/v1';
const c = await createSession('public', WS, `G_FILES name=rd.txt tag=${ST}`);
await waitTurn(c.session);
const S = c.session;
const cl = await closeSession('public', S, { key: K('close') });
await waitOp(S, opIdOf('public', cl), { timeoutMs: 90_000 });
async function reads(label) {
  const r = {
    get: await api('GET', `/v1/agents/sessions/${S}`),
    events: await api('GET', `/v1/agents/sessions/${S}/events?limit=200`),
    items: await api('GET', `/v1/agents/sessions/${S}/items`),
    turns: await api('GET', `/v1/agents/sessions/${S}/turns`),
    webGet: await api('POST', `${WEB}/sessions/get`, { sessionId: S }),
    transcript: await api('POST', `${WEB}/transcript/query`, { sessionId: S }),
    list: await api('GET', `/v1/agents/sessions?limit=100`),
    webList: await api('POST', `${WEB}/sessions/query`, { limit: 100 }),
    bobGet: await api('GET', `/v1/agents/sessions/${S}`, undefined, { actor: 'bob' }),
  };
  const inList = JSON.stringify(r.list.json).includes(S);
  const inWebList = JSON.stringify(r.webList.json).includes(S);
  const turnDone = JSON.stringify(r.events.json).includes('G_DONE');
  const s = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.status]));
  rep.note(`${label} read statuses`, `${j(s)} inPublicList=${inList} inWebList=${inWebList} eventsHaveTurnResult=${turnDone} session.status=${r.get.json.status ?? '-'}`);
  return { s, inList, inWebList, turnDone };
}
const closed = await reads('CLOSED');
await archive('public', S, { key: K('a') });
const arch = await reads('ARCHIVED');
rep.check('ARCHIVED: Session, events (with the Turn result), items, turns, WebShell get/transcript readable by creator and reader', ['get', 'events', 'items', 'turns', 'webGet', 'transcript', 'bobGet'].every((k) => arch.s[k] === 200) && arch.turnDone, j(arch.s));
rep.note('ARCHIVED Session in default lists', `public=${arch.inList} web=${arch.inWebList} (CLOSED: public=${closed.inList} web=${closed.inWebList})`);
await unarchive('web', S, { key: K('u') });
const un = await reads('UNARCHIVED');
rep.check('after unarchive: the same reads succeed', ['get', 'events', 'items', 'turns', 'webGet', 'transcript'].every((k) => un.s[k] === 200), j(un.s));
const res0 = resourcesOf(S);
const d = await del('public', S, { key: K('d') });
await waitFor(() => sessStatus(S) === 'DELETED', 30_000);
const gone = await reads('DELETED');
rep.check('DELETED: Session, events, items, turns, WebShell get/transcript all 404; absent from both lists', ['get', 'events', 'items', 'turns', 'webGet', 'transcript', 'bobGet'].every((k) => gone.s[k] === 404) && !gone.inList && !gone.inWebList, j(gone.s));
rep.check('DELETED: stored history resources and Workspace file retained (bytes not erased by L2)', resourcesOf(S).length === res0.length && res0.length > 0 && lxWs(ST, 'child/rd.txt') === `after-${ST}`, `resources=${res0.length}->${resourcesOf(S).length} file=${lxWs(ST, 'child/rd.txt')}`);
rep.done({ S, op: opId('public', d) });
