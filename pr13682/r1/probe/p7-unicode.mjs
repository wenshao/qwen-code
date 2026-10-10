// VERIFICATION RIG ONLY (PR #13682): Unicode-only titles. Each must be refused 400 before any command/delivery is
// written; close admission must keep working; a title with visible text keeps its exact code points in both stores.
// usage: DB=<db> node p7-unicode.mjs <workspace> <storage>
import { api, one, register, waitTurn, Report, sleep, TENANT, j } from './lib.mjs';
import { dbTitle, status, renameCmds, delivery, journalTitles, harnessTitle, titlePosts, rename, short, until } from './lib13682.mjs';
const [WS, ST] = process.argv.slice(2);
const r = new Report('p7-unicode');
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'G_FILES name=t.txt tag=t0' }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: `c-${stamp}` });
const S = c.json.id;
r.check('initial Turn COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED', S);
const cases = { NBSP: ' ', FEFF: '﻿', U2007: ' ', U202F: ' ', mixed: '   ﻿', IDEOSP: '　', LS: ' ' };
const results = {};
for (const [name, t] of Object.entries(cases)) {
  const before = { cmds: renameCmds(S).length, posts: titlePosts(S).length };
  const x = await rename(S, t, `u-${name}-${stamp}`);
  await sleep(300);
  results[name] = { status: x.status, code: x.json?.error?.code ?? null, cmds: renameCmds(S).length - before.cmds, posts: titlePosts(S).length - before.posts, delivery: delivery(S) };
  r.note(`${name} (${[...t].map((ch) => 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ')})`, `${short(x)}; commands +${results[name].cmds}; Harness title POSTs +${results[name].posts}; delivery ${j(results[name].delivery)}`);
}
r.check('all Unicode-blank titles answer 400 invalid_title', Object.values(results).every((x) => x.status === 400 && x.code === 'invalid_title'), j(Object.fromEntries(Object.entries(results).map(([n, x]) => [n, `${x.status} ${x.code}`]))));
r.check('no command row and no Harness call for any of them', Object.values(results).every((x) => x.cmds === 0 && x.posts === 0), j(Object.fromEntries(Object.entries(results).map(([n, x]) => [n, `${x.cmds}/${x.posts}`]))));
await sleep(1500);
const vis = 'A B C D';
const v = await rename(S, vis, `v-${stamp}`);
await sleep(800);
r.note('visible title with inner NBSP/U+2007/U+202F', `${short(v)}`);
r.check('visible title keeps its exact code points in both stores', dbTitle(S) === vis && harnessTitle(S) === vis, `DB ${j(dbTitle(S))} / Harness ${j(harnessTitle(S))}`);
const cl = await api('POST', `/v1/agents/sessions/${S}/close`, undefined, { actor: 'alice', key: `close-${stamp}` });
const fin = await until(() => status(S) === 'CLOSED', { timeoutMs: 30_000 });
r.note('close afterwards', `${short(cl)} → ${status(S)}`);
r.check('close is still admitted', [200, 202].includes(cl.status) && fin.ok, `${cl.status} ${status(S)}`);
r.done({ session: S, results, visible: { status: v.status, db: dbTitle(S), harness: harnessTitle(S) }, close: short(cl), final: status(S) });
process.exit(0);
