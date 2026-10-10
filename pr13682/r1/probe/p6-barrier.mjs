// VERIFICATION RIG ONLY (PR #13682): lifecycle sealing while a title delivery is unfinished. The Harness commits the
// title but the reply is lost (drop-after), and every redelivery is answered 503 for HOLD ms, so the delivery stays
// open. Close / archive / delete / cwd must refuse while it is open, and close must succeed once it settles.
// usage: DB=<db> HOLD=15000 node p6-barrier.mjs <workspace> <storage> <close|archive|delete>
import { api, one, register, waitTurn, setTapRules, Report, sleep, TENANT, j } from './lib.mjs';
import { dbTitle, status, renameCmds, delivery, journalTitles, harnessTitle, titlePosts, rename, short, until } from './lib13682.mjs';
const [WS, ST, LAST] = process.argv.slice(2);
const HOLD = Number(process.env.HOLD ?? 15_000);
const EMPTY = process.env.EMPTY === '1';
const r = new Report(`p6-barrier-${LAST}${EMPTY ? '-empty' : ''}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', ...(EMPTY ? {} : { input: [{ type: 'input_text', text: 'G_FILES name=t.txt tag=t0' }] }), workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: `c-${stamp}` });
const S = c.json.id;
if (EMPTY) r.note('empty Session (no Turn, no retained Runtime)', S); else r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', S);
const path = `/session/${S}/title`;
setTapRules([{ match: `POST ${path}`, action: 'drop-after', times: 1 }, { match: `POST ${path}`, action: 'respond', status: 503, body: { error: { code: 'rig_unavailable' } } }]);
await sleep(400);
const t0 = Date.now();
const a = await rename(S, 'Sealed Title', `k-${stamp}`);
r.note('rename (Harness committed, reply lost; redeliveries get 503)', `${short(a)}; DB ${dbTitle(S)}; Harness ${harnessTitle(S)}; delivery ${j(delivery(S))}`);
const k = (s) => `${s}-${stamp}-${Math.random().toString(16).slice(2, 6)}`;
const sess = await api('GET', `/v1/agents/sessions/${S}`, undefined, { actor: 'alice' });
const ctx = sess.json?.workspace?.context_revision ?? sess.json?.workspace?.contextRevision ?? sess.json?.context_revision ?? null;
const tries = {
  close: await api('POST', `/v1/agents/sessions/${S}/close`, undefined, { actor: 'alice', key: k('close') }),
  archive: await api('POST', `/v1/agents/sessions/${S}/archive`, undefined, { actor: 'alice', key: k('archive') }),
  cwd: await api('POST', `/v1/agents/sessions/${S}/cwd`, { cwd_relative: '.', ...(ctx !== null ? { expected_context_revision: ctx } : {}) }, { actor: 'alice', key: k('cwd') }),
};
for (const [n, x] of Object.entries(tries)) r.note(`${n} while the delivery is open (+${Date.now() - t0} ms)`, `${short(x)} ${x.json?.error?.message ?? ''}`);
r.note('status / titles right after the attempts', `${status(S)}; DB ${dbTitle(S)}; Harness ${harnessTitle(S)}`);
const sealedEarly = !['ACTIVE'].includes(status(S));
r.check('no lifecycle change is admitted while the title delivery is open', !sealedEarly && [tries.close, tries.archive].every((x) => x.status === 409), `${status(S)} close ${tries.close.status} archive ${tries.archive.status} cwd ${tries.cwd.status}`);
// keep it open, then heal
const opn = await until(() => Date.now() - t0 > HOLD, { timeoutMs: HOLD + 1000 });
r.note(`delivery after ${HOLD} ms of 503s`, `${j(delivery(S))}; title POSTs ${titlePosts(S).length}`);
setTapRules([]);
const healed = Date.now();
const settled = await until(() => { const d = delivery(S); return d === 'n/a' || d?.[3] === 'COMPLETED'; }, { timeoutMs: 90_000 });
r.note('delivery settles after the Harness recovers', settled.ok ? `+${Date.now() - healed} ms` : 'not within 90 s');
const last = LAST === 'delete' ? await api('DELETE', `/v1/agents/sessions/${S}`, undefined, { actor: 'alice', key: k('delete') }) : await api('POST', `/v1/agents/sessions/${S}/${LAST}`, undefined, { actor: 'alice', key: k(LAST) });
const fin = await until(() => !['ACTIVE'].includes(status(S)), { timeoutMs: 30_000 });
r.note(`${LAST} after the delivery settled`, `${short(last)} → ${status(S)} ${fin.ok ? `at +${fin.ms} ms` : '(still ACTIVE)'}`);
r.note('final titles', `DB ${dbTitle(S)} / Harness ${harnessTitle(S)}; commands ${j(renameCmds(S))}`);
r.check(`${LAST} is admitted once the delivery settled`, [200, 202].includes(last.status) && fin.ok, `${last.status} ${status(S)}`);
r.check('sealed Session keeps equal public and Harness titles', dbTitle(S) === harnessTitle(S), `DB ${dbTitle(S)} / Harness ${harnessTitle(S)}`);
r.done({ session: S, rename: short(a), tries: Object.fromEntries(Object.entries(tries).map(([n, x]) => [n, short(x)])), sealedEarly, settledMs: settled.ok ? settled.ms : null, last: short(last), final: status(S), db: dbTitle(S), harness: harnessTitle(S) });
process.exit(0);
