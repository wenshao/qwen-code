// VERIFICATION RIG ONLY (PR #13247) S9, trial merge with #13112 (bound later Turns):
// does the next tool Turn after a committed change really execute in the new directory?
import fs from 'node:fs';
import { api, Report, register, createSession, waitTurn, turnRow, sleep, j, sql, one, RUN, TENANT, WS as _WS } from './lib.mjs';
import { pubChange, opId, waitCwdOp, binding, mkdirWs, ctxEvents } from './cwd.mjs';

const R = new Report(process.env.NAME ?? 's9-later-turns');
const tag = Date.now() % 100000;
const WS = `ws-s9-${tag}`;
const ST = 'd';
register(WS, `st-${ST}`);
const root = fs.realpathSync(`${RUN}/ws/${ST}`);
const outside = `${RUN}/outside-s9-${tag}`;
fs.mkdirSync(outside, { recursive: true });
const msg = (text) => ({ type: 'agent.session.input.message', input: [{ type: 'input_text', text }] });
const later = async (s, text, key) => {
  const r = await api('POST', `/v1/agents/sessions/${s}/events`, msg(text), { key });
  const t = r.status === 202 ? await waitTurn(s) : null;
  return { r, t, last: turnRow(s).at(-1) };
};
const find = (name) => {
  const hits = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isSymbolicLink()) continue; if (e.isDirectory()) { try { walk(p); } catch {} } else if (e.name === name) hits.push(p.slice(root.length + 1)); } };
  walk(root);
  for (const e of fs.readdirSync(outside)) if (e === name) hits.push(`OUTSIDE/${e}`);
  return hits;
};
const runtimeCwds = (s) => sql(`SELECT COUNT(*) FROM qwen_runtime_session WHERE session_id='${s}'`)[0]?.[0];

const c = await createSession('public', WS, `G_WRITE name=t0-${tag}.txt content=zero`);
const s = c.session;
const t0 = await waitTurn(s);
R.check('initial Turn writes into child/', t0.status === 'COMPLETED' && j(find(`t0-${tag}.txt`)) === j([`child/t0-${tag}.txt`]), `${t0.status} ${j(find(`t0-${tag}.txt`))}`);

mkdirWs(ST, 'child2');
const a1 = await pubChange(s, 'child2', 1, { key: `s9-1-${tag}` });
const w1 = await waitCwdOp(s, opId(a1));
const l1 = await later(s, `G_WRITE name=t1-${tag}.txt content=one`, `s9-l1-${tag}`);
R.check('change child → child2 completes; next later Turn writes into child2/ (not child/)', w1.json.status === 'completed' && l1.t?.status === 'COMPLETED' && j(find(`t1-${tag}.txt`)) === j([`child2/t1-${tag}.txt`]), `${w1.json.status} turn=${l1.r.status}/${l1.t?.status} at ${j(find(`t1-${tag}.txt`))}`);

const a2 = await pubChange(s, 'missing-dir', 2, { key: `s9-2-${tag}` });
const w2 = await waitCwdOp(s, opId(a2));
const l2 = await later(s, `G_WRITE name=t2-${tag}.txt content=two`, `s9-l2-${tag}`);
R.check('refused change (missing dir) → next Turn still writes into child2/', w2.json.status === 'failed' && l2.t?.status === 'COMPLETED' && j(find(`t2-${tag}.txt`)) === j([`child2/t2-${tag}.txt`]), `${w2.json.status}/${w2.json.failure_code} turn=${l2.t?.status} at ${j(find(`t2-${tag}.txt`))}`);

const a3 = await pubChange(s, '.', 2, { key: `s9-3-${tag}` });
await waitCwdOp(s, opId(a3));
const l3 = await later(s, `G_WRITE name=t3-${tag}.txt content=three`, `s9-l3-${tag}`);
R.check('change → "." (Workspace root) → next Turn writes at the root', l3.t?.status === 'COMPLETED' && j(find(`t3-${tag}.txt`)) === j([`t3-${tag}.txt`]), `turn=${l3.t?.status} at ${j(find(`t3-${tag}.txt`))}`);

if (!process.env.SKIP_LOCKED) {
// mode 000: the settlement probe has no access(R_OK|X_OK) step; the design says the first Turn is refused, typed.
mkdirWs(ST, 'locked');
fs.chmodSync(`${root}/locked`, 0o000);
const a4 = await pubChange(s, 'locked', 3, { key: `s9-4-${tag}` });
const w4 = await waitCwdOp(s, opId(a4));
const l4 = await later(s, `G_WRITE name=t4-${tag}.txt content=four`, `s9-l4-${tag}`);
fs.chmodSync(`${root}/locked`, 0o755);
R.note('change → mode-000 dir', `${w4.json.status} rev=${binding(s).rev}`);
R.check('…its next Turn does not run tools anywhere and ends typed (not silently in another dir)', l4.t?.status !== 'COMPLETED' || find(`t4-${tag}.txt`).length === 0, `turn=${l4.r.status}/${l4.t?.status} error=${l4.last?.[2]} files=${j(find(`t4-${tag}.txt`))}`);
const a4b = await pubChange(s, 'child', binding(s).rev, { key: `s9-4b-${tag}` });
const w4b = await waitCwdOp(s, opId(a4b));
const l4b = await later(s, `G_WRITE name=t4b-${tag}.txt content=fourb`, `s9-l4b-${tag}`);
R.check('…recoverable: change back to child, next Turn writes into child/', w4b.json.status === 'completed' && l4b.t?.status === 'COMPLETED' && j(find(`t4b-${tag}.txt`)) === j([`child/t4b-${tag}.txt`]), `${w4b.json.status} turn=${l4b.t?.status} error=${l4b.last?.[2]} at ${j(find(`t4b-${tag}.txt`))}`);

}
// directory swapped for a symlink to outside AFTER the commit
mkdirWs(ST, 'swap');
const a5 = await pubChange(s, 'swap', binding(s).rev, { key: `s9-5-${tag}` });
const w5 = await waitCwdOp(s, opId(a5));
fs.rmSync(`${root}/swap`, { recursive: true });
fs.symlinkSync(outside, `${root}/swap`);
const l5 = await later(s, `G_WRITE name=t5-${tag}.txt content=five`, `s9-l5-${tag}`);
R.check('committed dir later replaced by a symlink to outside → next Turn refused, nothing written outside', w5.json.status === 'completed' && l5.t?.status !== 'COMPLETED' && find(`t5-${tag}.txt`).length === 0 && fs.readdirSync(outside).length === 0, `${w5.json.status} turn=${l5.r.status}/${l5.t?.status} error=${l5.last?.[2]} files=${j(find(`t5-${tag}.txt`))} outside=${j(fs.readdirSync(outside))}`);
fs.rmSync(`${root}/swap`);
const a5b = await pubChange(s, 'child2', binding(s).rev, { key: `s9-5b-${tag}` });
const w5b = await waitCwdOp(s, opId(a5b));
const l5b = await later(s, `G_WRITE name=t5b-${tag}.txt content=fiveb`, `s9-l5b-${tag}`);
R.check('…and the Session recovers with another change', w5b.json.status === 'completed' && l5b.t?.status === 'COMPLETED' && j(find(`t5b-${tag}.txt`)) === j([`child2/t5b-${tag}.txt`]), `${w5b.json.status} turn=${l5b.t?.status} error=${l5b.last?.[2]} at ${j(find(`t5b-${tag}.txt`))}`);

// reverse race: a later Turn submitted while a cwd change is open (claim held 4 s by the rig trigger)
mkdirWs(ST, `trap-claim-s9-${tag}`);
const rev = binding(s).rev;
const a6 = await pubChange(s, `trap-claim-s9-${tag}`, rev, { key: `s9-6-${tag}` });
await sleep(500);
const sub = await api('POST', `/v1/agents/sessions/${s}/events`, msg(`G_WRITE name=t6-${tag}.txt content=six`), { key: `s9-l6-${tag}` });
const w6 = await waitCwdOp(s, opId(a6), { timeoutMs: 20_000 });
const t6 = await waitTurn(s);
R.note('later Turn submitted while the cwd operation is open', `submit=${sub.status} ${sub.json.error?.code ?? ''} → turn ${t6.status}, file at ${j(find(`t6-${tag}.txt`))}; cwd op ${w6.json.status}/${w6.json.failure_code ?? ''}; binding ${j(binding(s))}`);
R.check('exactly one side wins: either the Turn is refused or the cwd op fails session_context_busy (never both run)', (sub.status !== 202 && w6.json.status === 'completed') || (sub.status === 202 && w6.json.status === 'failed' && w6.json.failure_code === 'session_context_busy' && binding(s).rev === rev), `submit=${sub.status} op=${w6.json.status}/${w6.json.failure_code ?? ''}`);
R.note('session.context.changed rows', String(ctxEvents(s).length));
R.done({ session: s });
