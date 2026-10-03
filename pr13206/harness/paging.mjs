// VERIFICATION RIG ONLY (PR #13206): raw-path paging (no snapshot) across a resync.
// Requires Spring on DB=raw with the materializer off (materialize-interval=24h).
//   s6-raw-resync-hole       a corrupt terminal frame resyncs the head arm while a page fetch is in flight
//   s8-lag-gap-stale-page    the page was opened before materialization; a real server gap lands while a
//                            page fetch is in flight; the reload is a full-history snapshot
// usage: DB=raw node paging.mjs <scenario>
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createSession, waitTurn, submit, lastSeq, snapshotCovered, setWireRules, wireEntries, sql, sleep, Report, ensureWorkspace, WS, ST, RIG, DB, j } from './lib.mjs';
import { launch, open, markers, analyse, alertText, shot, transcriptCalls, streamCalls } from './ui.mjs';

const name = process.argv[2];
const r = new Report(name);
ensureWorkspace(WS, `st-${ST}`);
setWireRules([]);
const N = 260;
const tag = name.startsWith('s6') ? 'RW' : 'LG';

function holes(nums) {
  if (!nums.length) return [];
  const set = new Set(nums);
  const out = [];
  for (let i = Math.min(...nums); i <= Math.max(...nums); i++) if (!set.has(i)) out.push(i);
  return out;
}
const summary = (nums, n) => {
  const a = analyse(nums, n);
  return { min: nums.length ? Math.min(...nums) : null, max: a.max, count: a.count, holesInside: holes(nums), dup: a.dup, ordered: a.ordered };
};
async function scrollTop(page) {
  return page.evaluate(() => {
    const row = document.querySelector('[data-message-row-key]');
    let el = row?.parentElement;
    while (el && !(el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    if (!el) return false;
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll'));
    return true;
  });
}
const pages = (net, t) => transcriptCalls(net).filter((e) => e.t >= t).map((e) => e.body?.cursor ?? 'none');

const created = await createSession('public', WS, `UI_STREAM n=${N} delay=0 tag=${tag} para=1`);
const session = created.session;
r.check('turn 1 completed', (await waitTurn(session, { timeoutMs: 90_000 })).status === 'COMPLETED', session);
await sleep(1000);
r.check('no snapshot (raw transcript path)', snapshotCovered(session) === 0, `lastSequence=${lastSeq(session)} covered=${snapshotCovered(session)}`);
const browser = await launch();
const arms = {};
for (const arm of ['base', 'head']) arms[arm] = await open(browser, { arm, session });
for (const arm of ['base', 'head']) await arms[arm].page.getByText(`[${tag}-${N}]`).first().waitFor({ timeout: 20_000 });
await sleep(1500);
const out = { session, steps: {} };
async function measure(label, extra = {}) {
  for (const arm of ['base', 'head']) {
    const { page, net } = arms[arm];
    const res = { R: summary(await markers(page, tag), N), alerts: await alertText(page), pageCursors: pages(net, 0), ...extra[arm] };
    if (extra.q) res.Q = summary(await markers(page, `${tag}Q`), extra.q);
    (out.steps[label] ??= {})[arm] = res;
    r.note(`${arm} [${label}]`, j(res));
  }
}
await measure('opened');
for (const arm of ['base', 'head']) await scrollTop(arms[arm].page);
await sleep(2500);
await measure('after one page');

if (name === 's6-raw-resync-hole') {
  setWireRules([
    { kind: 'frame', session, event: 'turn.completed', action: 'corrupt' },
    { kind: 'hold', path: '/transcript/query$', bodyContains: '"cursor"', ms: 10000, times: 2 },
  ]);
  const tHold = Date.now();
  for (const arm of ['base', 'head']) await scrollTop(arms[arm].page);
  await sleep(500);
  await submit(session, `UI_STREAM n=30 delay=40 tag=${tag}Q para=1`);
  r.check('turn 2 completed', (await waitTurn(session, { timeoutMs: 60_000 })).status === 'COMPLETED');
  await sleep(14_000);
  const wire = wireEntries().filter((e) => e.t >= tHold);
  out.wireTranscripts = wire.filter((e) => e.kind === 'req' && e.path.endsWith('/transcript/query') && e.body?.sessionId === session).map((e) => ({ t: e.t - tHold, cursor: e.body.cursor ?? 'none', held: wire.some((h) => h.kind === 'hold' && h.reqId === e.reqId) }));
  r.note('wire transcript requests after the in-flight page started', j(out.wireTranscripts));
  await measure('after corrupt terminal + in-flight page', { q: 30 });
  for (const arm of ['base', 'head']) await shot(arms[arm].page, `${name}-${arm}-after`);
  setWireRules([]);
  // Page all the way back on the head arm; the base arm is wedged, so reload it first.
  await arms.base.page.reload({ waitUntil: 'load' });
  await arms.base.page.getByText(`[${tag}Q-030]`).first().waitFor({ timeout: 20_000 });
  for (let i = 0; i < 8; i++) {
    for (const arm of ['base', 'head']) await scrollTop(arms[arm].page);
    await sleep(1800);
  }
  await measure('paged to the beginning', { q: 30 });
}

if (name === 's8-lag-gap-stale-page') {
  const STREAM = '/events/stream' + '$';
  const PAGE = '/transcript/query' + '$';
  setWireRules([
    { kind: 'hold', path: PAGE, bodyContains: '"cursor"', ms: 80000, times: 2 },
    { kind: 'hold', path: STREAM, bodyContains: session, ms: 45000 },
  ]);
  const tHold = Date.now();
  for (const arm of ['base', 'head']) await scrollTop(arms[arm].page);
  await sleep(1000);
  // Restart the server with the materializer on (as after a deploy that clears a materialization backlog).
  spawnSync(`${RIG}/stop.sh`, [DB, 'spring'], { encoding: 'utf8' });
  const up = spawnSync(`${RIG}/spring.sh`, ['head', DB, 'absent', 'absent', '--qwen.managed-agent.runtime-broker.durable-local-process=false', '--qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false'], { encoding: 'utf8' });
  r.note('spring restarted with the materializer on', up.stdout.trim().split('\n').at(-1));
  // The Hosted Harness is bound to the previous server incarnation (session load answers 409): restart it too.
  spawnSync(`${RIG}/stop.sh`, [DB, 'harness'], { encoding: 'utf8' });
  const hup = spawnSync(`${RIG}/harness.sh`, [DB, 'head'], { encoding: 'utf8' });
  r.note('harness restarted', hup.stdout.trim().split('\n').at(-1));
  // The browsers are disconnected (their reconnects are held): a further turn lands meanwhile.
  await submit(session, `UI_STREAM n=20 delay=0 tag=${tag}Q para=1`);
  r.check('turn 2 completed while the browsers were away', (await waitTurn(session, { timeoutMs: 60_000 })).status === 'COMPLETED');
  for (let i = 0; i < 100 && snapshotCovered(session) < lastSeq(session); i++) await sleep(100);
  const covered = snapshotCovered(session);
  // What the server's own advanceReplayFloor would do (floor <= snapshot covered sequence); nothing calls it yet.
  sql(`UPDATE managed_agent_session SET replay_floor_sequence=${covered} WHERE session_id='${session}'`);
  r.note('snapshot materialized; replay floor raised to it', `covered=${covered} lastSequence=${lastSeq(session)} t=+${Date.now() - tHold} ms`);
  setWireRules([{ kind: 'hold', path: PAGE, bodyContains: '"cursor"', ms: 80000, times: 0 }]);
  await sleep(Math.max(0, 92_000 - (Date.now() - tHold)));
  const wire = wireEntries().filter((e) => e.t >= tHold);
  out.resyncFrames = wire.filter((e) => e.kind === 'frame' && e.event === 'agent.session.resync_required' && e.session === session).map((e) => ({ t: e.t - tHold, req: e.reqId }));
  out.wireTranscripts = wire.filter((e) => e.kind === 'req' && e.path.endsWith('/transcript/query') && e.body?.sessionId === session).map((e) => ({ t: e.t - tHold, req: e.reqId, cursor: e.body.cursor ?? 'none', held: wire.some((h) => h.kind === 'hold' && h.reqId === e.reqId), answeredAt: (wire.find((x) => x.kind === 'res' && x.reqId === e.reqId)?.t ?? 0) - tHold }));
  r.check('the server sent resync_required to both arms', out.resyncFrames.length >= 2, j(out.resyncFrames));
  r.note('wire transcript requests', j(out.wireTranscripts));
  await measure('after the gap and the stale page', { q: 20 });
  for (const arm of ['base', 'head']) {
    await shot(arms[arm].page, `${name}-${arm}-after`);
    await arms[arm].page.getByText(`[${tag}-${N}]`).first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await sleep(400);
    await shot(arms[arm].page, `${name}-${arm}-at-end-of-answer`);
  }
  sql(`UPDATE managed_agent_session SET replay_floor_sequence=0 WHERE session_id='${session}'`);
}

fs.writeFileSync(`${RIG}/out/${DB}/${name}-results.json`, JSON.stringify(out, null, 2));
setWireRules([]);
await browser.close();
r.done(out);
