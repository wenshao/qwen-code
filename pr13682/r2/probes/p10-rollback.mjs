// VERIFICATION RIG ONLY (PR #13682 R2): bot finding R2-4 on the real stack. A title delivery is left open, then the
// Hosted Harness is rolled back to main's bundle (no title protocol v1), so every recovery attempt is refused before
// anything is sent. Does the delivery ever reach a terminal state, what stays blocked, and does it heal once the new
// Harness is back? Modes:
//   lost    the first attempt reached the Harness and committed, its reply was lost (tap drop-after), and further
//           attempts are held off with 503 until the rollback
//   unsent  no attempt ever reached the Harness (tap drop-before) before the rollback
// usage: DB=<db> SWAP_OLD='cmd' SWAP_NEW='cmd' ALOG=<A log> WATCH=<ms> node p10-rollback.mjs <lost|unsent> <ws> <storage>
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { api, one, register, waitTurn, setTapRules, Report, sleep, TENANT, j } from './lib.mjs';
import { dbTitle, renameCmds, delivery, journalTitles, harnessTitle, titlePosts, rename, short, until, status } from './lib13682.mjs';
const [MODE, WS, ST] = process.argv.slice(2);
const WATCH = Number(process.env.WATCH ?? 150_000);
const r = new Report(`p10-rollback-${MODE}`);
if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${WS}'`) === '0') register(WS, `st-${ST}`);
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const mk = async (tag) => {
  const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: `G_FILES name=${tag}.txt tag=${tag}` }], workspace: { workspace_id: WS, cwd_relative: 'child' } }, { actor: 'alice', key: `c-${tag}-${stamp}` });
  return c.json.id;
};
const S = await mk('r');
const S2 = await mk('s'); // a sibling Session on the same storage with no rename
r.check('initial Turns COMPLETED', (await waitTurn(S, { timeoutMs: 90_000 })).status === 'COMPLETED' && (await waitTurn(S2, { timeoutMs: 90_000 })).status === 'COMPLETED');
const path = `/session/${S}/title`;
const K = `k-${stamp}`;
const TITLE = 'Rollback Title';
setTapRules(MODE === 'lost'
  ? [{ match: `POST ${path}`, action: 'drop-after', times: 1 }, { match: `POST ${path}`, action: 'respond', status: 503, body: { error: { code: 'rig_unavailable' } } }]
  : [{ match: `POST ${path}`, action: 'drop-before' }]);
await sleep(400);
const t0 = Date.now();
const a = await rename(S, TITLE, K);
await sleep(1500);
r.note('rename answer', `${short(a)} after ${Date.now() - t0} ms; DB ${dbTitle(S)}; journal ${j(journalTitles(S).map((x) => `${x.title}@${x.managedRenameRevision}`))}; commands ${j(renameCmds(S))}; delivery ${j(delivery(S))}`);
const sentBefore = titlePosts(S).filter((p) => p.fault !== 'drop-before').length;
// Roll the Harness back to main's bundle, then let traffic through the tap again.
const swapOld = execSync(process.env.SWAP_OLD, { encoding: 'utf8' }).trim().split('\n').at(-1);
setTapRules([]);
r.note('Harness rolled back', swapOld);
const posts0 = titlePosts(S).length;
const unsettled = () => one(`SELECT COUNT(*) FROM managed_agent_session s JOIN managed_session_rename_delivery r ON r.tenant_id = s.tenant_id AND r.session_id = s.session_id WHERE s.tenant_id='${TENANT}' AND s.workspace_storage_id='st-${ST}' AND r.delivery_state <> 'COMPLETED'`);
const t1 = Date.now(); const samples = [];
let closeTry = null, cwdTry = null, close2 = null;
while (Date.now() - t1 < WATCH) {
  const d = delivery(S);
  const v = d && d !== 'n/a' ? [d[3], Number(d[4])] : d;
  if (j(samples.at(-1)?.v) !== j(v)) samples.push({ at: Date.now() - t1, v, avail: d && d !== 'n/a' ? Number(d[6]) - Date.now() : null });
  if (!closeTry && Date.now() - t1 > 20_000) {
    const sess = await api('GET', `/v1/agents/sessions/${S}`, undefined, { actor: 'alice' });
    const ctx = sess.json?.workspace?.context_revision ?? sess.json?.workspace?.contextRevision ?? sess.json?.context_revision ?? null;
    closeTry = short(await api('POST', `/v1/agents/sessions/${S}/close`, undefined, { actor: 'alice', key: `cl-${stamp}` }));
    cwdTry = short(await api('POST', `/v1/agents/sessions/${S}/cwd`, { cwd_relative: '.', ...(ctx !== null ? { expected_context_revision: ctx } : {}) }, { actor: 'alice', key: `cwd-${stamp}` }));
    close2 = short(await api('POST', `/v1/agents/sessions/${S2}/close`, undefined, { actor: 'alice', key: `cl2-${stamp}` }));
  }
  await sleep(500);
}
const dEnd = delivery(S);
const alog = process.env.ALOG && fs.existsSync(process.env.ALOG) ? fs.readFileSync(process.env.ALOG, 'utf8').split('\n').filter((l) => l.includes(S) && l.includes('will retry')) : [];
r.note(`delivery row during ${WATCH / 1000} s on the old Harness (at ms: [state, attempts])`, j(samples.map((s) => [s.at, s.v])));
r.note('A log: retry lines for this Session', `${alog.length}; last: ${(alog.at(-1) ?? '').replace(/^.*?failure=/, 'failure=').slice(0, 220)}`);
r.note('title POSTs that reached the tap while rolled back', `${titlePosts(S).length - posts0}`);
r.note('while rolled back: close / cwd on the renamed Session; close on the sibling Session', `${closeTry} / ${cwdTry} / ${close2}`);
r.note('requireIdle rename-delivery predicate for the storage', `${unsettled()} open row(s) → WorkspaceMigrationMain store/retire/verify would answer migration_work_unsettled`);
r.check('the delivery is still open (no terminal state) after the watch window', dEnd && dEnd !== 'n/a' && dEnd[3] !== 'COMPLETED', j(dEnd));
r.note('public vs private title while rolled back', `public ${dbTitle(S)} / private ${harnessTitle(S)}`);
// Roll forward again.
const swapNew = execSync(process.env.SWAP_NEW, { encoding: 'utf8' }).trim().split('\n').at(-1);
r.note('Harness rolled forward', swapNew);
const t2 = Date.now();
const healed = await until(() => { const d = delivery(S); return d && d[3] === 'COMPLETED'; }, { timeoutMs: 120_000, every: 250 });
r.note('delivery after roll-forward', healed.ok ? `COMPLETED at +${healed.ms} ms (attempts ${delivery(S)[4]})` : `still ${j(delivery(S))} after ${healed.ms} ms`);
const jt = journalTitles(S);
r.check('titles agree after roll-forward', dbTitle(S) === TITLE && harnessTitle(S) === TITLE, `public ${dbTitle(S)} / private ${harnessTitle(S)}`);
r.note('journal title records', j(jt.map((x) => `${x.title}@${x.managedRenameRevision}`)));
r.note('commands', j(renameCmds(S)));
const cl = await api('POST', `/v1/agents/sessions/${S}/close`, undefined, { actor: 'alice', key: `cl3-${stamp}` });
await until(() => status(S) === 'CLOSED', { timeoutMs: 30_000 });
r.check('close admitted after roll-forward', cl.status === 202 || cl.status === 200, `${short(cl)} → ${status(S)}`);
r.done({ session: S, mode: MODE, first: short(a), sentBefore, samples, retryLines: alog.length, closeTry, cwdTry, close2, healed: healed.ok ? healed.ms : null, journal: jt, end: status(S) });
process.exit(0);
