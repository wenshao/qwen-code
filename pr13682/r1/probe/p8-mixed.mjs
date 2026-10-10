// VERIFICATION RIG ONLY (PR #13682): mixed versions. Rename against whatever Harness this arm runs, then close.
// usage: DB=<db> node p8-mixed.mjs <workspace> <storage>
import { api, one, register, waitTurn, Report, sleep, TENANT, j } from './lib.mjs';
import { dbTitle, status, renameCmds, delivery, journalTitles, harnessTitle, titlePosts, rename, short, until } from './lib13682.mjs';
const [WS, ST] = process.argv.slice(2);
const r = new Report('p8-mixed');
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=t.txt tag=t0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: `c-${stamp}` });
const S = c.json.id;
r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', S);
const x = await rename(S, 'Mixed Title', `m-${stamp}`);
await sleep(1500);
r.note('rename', `${short(x)} ${x.json?.error?.message ?? ''}`);
r.note('after rename', `DB ${dbTitle(S)} / Harness ${harnessTitle(S)}; commands ${j(renameCmds(S))}; delivery ${j(delivery(S))}; title POSTs ${j(titlePosts(S).map((p) => `${p.title}@${p.rev ?? '-'}:${p.status}`))}`);
const cl = await api('POST', `/v1/agents/sessions/${S}/close`, undefined, { actor: 'alice', key: `close-${stamp}` });
const fin = await until(() => status(S) === 'CLOSED', { timeoutMs: 30_000 });
r.note('close', `${short(cl)} → ${status(S)}`);
r.done({ session: S, rename: short(x), cmds: renameCmds(S), delivery: delivery(S), db: dbTitle(S), harness: harnessTitle(S), posts: titlePosts(S), close: short(cl), final: status(S) });
process.exit(0);
