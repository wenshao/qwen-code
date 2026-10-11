// VERIFICATION RIG ONLY (PR #13682 R2): sibling replica configuration of the fixed B-replica bug. The PR stops a
// Harness-*disabled* replica from claiming deliveries; here replica C has the Harness enabled but Hosted Workspace files
// disabled (the property's default), so it cannot attach a Workspace Session either. Run with and without C and compare
// how long a retried approval answer / a lost-reply title takes to land and how many attempts it burns.
// usage: DB=<db> CLOG=<C log or ''> node p11-wsoff.mjs <approval|rename> <ws> <storage> <n>
import fs from 'node:fs';
import { api, sql, one, register, waitTurn, waitPending, respond, setTapRules, readWs, Report, sleep, TENANT, j } from './lib.mjs';
import { dbTitle, renameCmds, delivery, journalTitles, harnessTitle, rename, short, until } from './lib13682.mjs';
const [KIND, WS, ST, NS] = process.argv.slice(2);
const N = Number(NS ?? 4);
const r = new Report(`p11-wsoff-${KIND}-${process.env.CLOG ? 'withC' : 'noC'}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const clines = (id) => (process.env.CLOG && fs.existsSync(process.env.CLOG) ? fs.readFileSync(process.env.CLOG, 'utf8').split('\n').filter((l) => l.includes(id)) : []);
const runs = [];
for (let i = 0; i < N; i++) {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
  if (KIND === 'approval') {
    const tag = `w${i}-${Date.now() % 100000}`;
    const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: `G_WRITE name=${tag}.txt content=v${i}` }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: `c-${stamp}` });
    const S = c.json.id;
    const p = await waitPending(S, { timeoutMs: 60_000 });
    if (p.timeout) { runs.push({ i, S, error: 'no pending action' }); continue; }
    setTapRules([{ match: `POST /session/${S}/actions/.*/resolve`, action: 'respond', status: 503, times: 1, body: { error: { code: 'rig_unavailable' } } }]);
    await sleep(300);
    const t0 = Date.now();
    const ans = await respond('public', S, p.action, 'allow', { key: `a-${stamp}` });
    const opId = one(`SELECT operation_id FROM managed_agent_operation WHERE session_id='${S}' AND operation_kind='ACTION_RESPONSE' ORDER BY created_at DESC LIMIT 1`);
    const opq = () => sql(`SELECT state, attempt_count FROM managed_agent_operation WHERE operation_id='${opId}'`)[0];
    const done = await until(() => ['COMPLETED', 'FAILED'].includes(opq()?.[0]), { timeoutMs: 180_000, every: 100 });
    const end = await waitTurn(S, { timeoutMs: 60_000 });
    await sleep(500);
    const file = readWs(ST, `child/${tag}.txt`);
    const cl = clines(opId);
    runs.push({ i, S, ans: ans.status, settledMs: done.ok ? done.ms : null, op: opq(), turn: end.status, file, cLines: cl.length, cFailure: (cl.find((l) => /retry|fail/i.test(l)) ?? '').replace(/^.*?(operation=|failure=)/, '$1').slice(0, 160) });
  } else {
    const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: `c-${stamp}` });
    const S = c.json.id;
    setTapRules([{ match: `POST /session/${S}/title`, action: 'drop-after', times: 1 }]);
    await sleep(300);
    const K = `k-${stamp}`; const T = `Lost ${i}`;
    const t0 = Date.now();
    const a = await rename(S, T, K);
    const done = await until(() => renameCmds(S).some(([k, s]) => k === K && s === 'COMPLETED') && dbTitle(S) === T, { timeoutMs: 180_000, every: 100 });
    const d = delivery(S);
    const cl = clines(S);
    runs.push({ i, S, first: short(a), settledMs: done.ok ? Date.now() - t0 : null, attempts: d?.[4] ?? null, agree: dbTitle(S) === harnessTitle(S), records: journalTitles(S).length, cLines: cl.length, cFailure: (cl.find((l) => /retry/i.test(l)) ?? '').replace(/^.*?failure=/, 'failure=').slice(0, 160) });
  }
  r.note(`run ${i}`, j(runs.at(-1)));
  setTapRules([]);
  await sleep(500);
}
const ms = runs.map((x) => x.settledMs).filter((x) => x !== null).sort((a, b) => a - b);
r.note('settle times (ms, sorted)', j(ms));
r.note('runs with C log lines naming the item', `${runs.filter((x) => x.cLines > 0).length}/${runs.length}`);
r.check('every item eventually settles', ms.length === runs.length, `${ms.length}/${runs.length}`);
r.done({ kind: KIND, withC: !!process.env.CLOG, runs, ms });
process.exit(0);
