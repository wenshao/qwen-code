// VERIFICATION RIG ONLY (PR #13682): the Harness commits a title but its reply is lost (tap drop-after). Does the
// public receipt complete without a client retry and without a second title record? Kinds: turn (bound, after one
// Turn), empty (bound, created without input), unbound (no Workspace, created without input).
// usage: DB=<db> node p5-lost-reply.mjs <turn|empty|unbound> <workspace> <storage>
import { api, one, register, waitTurn, setTapRules, Report, sleep, TENANT, j } from './lib.mjs';
import { dbTitle, renameCmds, delivery, journalTitles, harnessTitle, titlePosts, rename, short, until } from './lib13682.mjs';
const [KIND, WS, ST] = process.argv.slice(2);
const r = new Report(`p5-lost-reply-${KIND}`);
if (KIND !== 'unbound' && one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const body = { agent_id: 'qwen-code' };
if (KIND === 'turn') body.input = [{ type: 'input_text', text: 'G_FILES name=t.txt tag=t0' }];
if (KIND !== 'unbound') body.workspace = { workspace_id: WS, cwd_relative: 'child' };
const c = await api('POST', '/v1/agents/sessions', body, { actor: 'alice', key: `c-${stamp}` });
const S = c.json.id;
r.note('create', `${c.status} ${S}`);
if (KIND === 'turn') r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED');
const path = `/session/${S}/title`;
const K = `k-${stamp}`;
setTapRules([{ match: `POST ${path}`, action: 'drop-after', times: 1 }]);
await sleep(400);
const t0 = Date.now();
const a = await rename(S, 'Lost Reply Title', K);
r.note('rename whose reply is lost after the Harness committed', `${short(a)} after ${Date.now() - t0} ms; DB ${dbTitle(S)}; commands ${j(renameCmds(S))}; delivery ${j(delivery(S))}`);
setTapRules([]);
const done = await until(() => renameCmds(S).some(([k, s]) => k === K && s === 'COMPLETED') && dbTitle(S) === 'Lost Reply Title', { timeoutMs: 30_000 });
r.note('waited (no client retry) for the receipt to complete', done.ok ? `completed at +${Date.now() - t0} ms` : `not completed within ${done.ms} ms`);
const posts = titlePosts(S);
r.note('title POSTs seen by the tap', j(posts.map((p) => `${p.title}@${p.rev ?? '-'}:${p.fault ?? '-'}:${p.status ?? '-'}`)));
const jt = journalTitles(S);
r.note('journal title records', j(jt.map((x) => `${x.title}@${x.managedRenameRevision ?? '-'}:${x.cmd}`)));
r.check('public receipt completes without a client retry', done.ok, j(renameCmds(S)));
r.check('public and Harness titles agree', dbTitle(S) === harnessTitle(S), `DB ${dbTitle(S)} / Harness ${harnessTitle(S)}`);
r.check('exactly one title record in the journal', jt.length === 1, `${jt.length}`);
// Replay the completed key, then the same key with different content.
const n0 = titlePosts(S).length;
const rp = await rename(S, 'Lost Reply Title', K);
const rc = await rename(S, 'Changed Content', K);
await sleep(800);
r.note('replay of the completed key / same key with changed content', `${short(rp)} / ${short(rc)}; Harness title POSTs added ${titlePosts(S).length - n0}; journal records ${journalTitles(S).length}`);
r.check('replay writes nothing; changed content conflicts', rp.status === 200 && rc.status === 409 && titlePosts(S).length === n0 && journalTitles(S).length === jt.length, `${rp.status}/${rc.status}`);
r.done({ session: S, kind: KIND, first: short(a), completed: done.ok, completedMs: done.ok ? done.ms : null, posts, journal: jt, replay: short(rp), changed: short(rc) });
process.exit(0);
