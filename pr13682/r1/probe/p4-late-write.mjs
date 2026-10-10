// VERIFICATION RIG ONLY (PR #13682): an accepted older rename whose request times out after sending must not
// overwrite a newer title. K1 "Alpha" is held at the tap (forwarded to the Harness only after HOLD ms, longer than
// the Java request timeout), K2 "Bravo" completes meanwhile, then K1 lands at the Harness. Both durable titles must
// end at "Bravo". Then a retry of the original K1 must get a fresh revision and win ("Alpha" in both stores).
// usage: DB=<db> HOLD=40000 node p4-late-write.mjs <bound|unbound> <workspace> <storage>
import { api, one, register, waitTurn, setTapRules, Report, sleep, TENANT, j } from './lib.mjs';
import { dbTitle, renameCmds, delivery, journalTitles, harnessTitle, titlePosts, rename, short, until } from './lib13682.mjs';
const [KIND, WS, ST] = process.argv.slice(2);
const HOLD = Number(process.env.HOLD ?? 40_000);
const r = new Report(`p4-late-write-${KIND}`);
if (KIND === 'bound' && one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const body = { agent_id: 'qwen-code', input: [{ type: 'input_text', text: KIND === 'bound' ? 'G_FILES name=t.txt tag=t0' : 'PLAIN first' }] };
if (KIND === 'bound') body.workspace = { workspace_id: WS, cwd_relative: 'child' };
const c = await api('POST', '/v1/agents/sessions', body, { actor: 'alice', key: `c-${stamp}` });
const S = c.json.id;
r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', S);
const path = `/session/${S}/title`;
const K1 = `k1-${stamp}`, K2 = `k2-${stamp}`;
setTapRules([{ match: `POST ${path}`, action: 'delay', delayMs: HOLD, times: 1 }]);
await sleep(400);
const t0 = Date.now();
const a1 = await rename(S, 'Alpha', K1, { timeoutMs: HOLD + 30_000 });
r.note(`K1 → Alpha (held ${HOLD} ms at the tap before reaching the Harness)`, `${short(a1)} after ${Date.now() - t0} ms; K1 rows ${j(renameCmds(S))}; delivery ${j(delivery(S))}`);
const k2 = await rename(S, 'Bravo', K2);
r.note('K2 → Bravo right after K1 answered', `${short(k2)} at +${Date.now() - t0} ms; DB ${dbTitle(S)}; journal ${j(journalTitles(S).map((x) => `${x.title}@${x.managedRenameRevision ?? '-'}`))}`);
// Wait for the held K1 request to reach the Harness and answer.
await until(() => titlePosts(S).some((p) => p.fault === 'delay' && p.status !== null), { timeoutMs: HOLD + 20_000 });
await sleep(4000);
const posts = titlePosts(S);
const late = posts.find((p) => p.fault === 'delay');
r.note('held K1 request reached the Harness late and was answered', `${late?.status} rev=${late?.rev ?? 'none'} at +${Date.parse(late?.t ?? 0) - t0 + HOLD} ms`);
const db1 = dbTitle(S), h1 = harnessTitle(S);
r.note('title POSTs seen by the tap', j(posts.map((p) => `${p.title}@${p.rev ?? '-'}:${p.fault ?? '-'}:${p.status ?? '-'}`)));
r.note('journal title records (title@revision)', j(journalTitles(S).map((x) => `${x.title}@${x.managedRenameRevision ?? '-'}`)));
r.note('rename commands', j(renameCmds(S)));
r.note('delivery row', j(delivery(S)));
r.check('after the late K1 write: public title is Bravo', db1 === 'Bravo', db1);
r.check('after the late K1 write: Harness journal title is Bravo', h1 === 'Bravo', h1);
// Retry the original key.
const a2 = await rename(S, 'Alpha', K1);
await sleep(2500);
const db2 = dbTitle(S), h2 = harnessTitle(S);
r.note('K1 retried after Bravo', `${short(a2)}; delivery ${j(delivery(S))}; commands ${j(renameCmds(S))}`);
r.check('K1 retry wins in both stores (Alpha)', db2 === 'Alpha' && h2 === 'Alpha', `DB ${db2} / Harness ${h2}`);
r.note('journal title records at the end', j(journalTitles(S).map((x) => `${x.title}@${x.managedRenameRevision ?? '-'}:${x.cmd}`)));
setTapRules([]);
r.done({ session: S, kind: KIND, a1: short(a1), k2: short(k2), late: late?.status ?? null, afterLate: { db: db1, harness: h1 }, a2: short(a2), end: { db: db2, harness: h2 }, journal: journalTitles(S) });
process.exit(0);
