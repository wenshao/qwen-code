// VERIFICATION RIG ONLY (PR #13206): stall guard, poisoned store row and real server gap scenarios.
// Both arms watch the SAME Session at the same time.  usage: node gap.mjs <s4-stall|s0-poisoned-row|s5-gap-snapshot>
import fs from 'node:fs';
import { createSession, waitTurn, submit, lastSeq, snapshotCovered, setWireRules, wireEntries, killStreams, sql, one, sleep, Report, ensureWorkspace, WS, ST, RIG, DB, j } from './lib.mjs';
import { launch, open, markers, analyse, alertText, shot, streamCalls, transcriptCalls } from './ui.mjs';

const name = process.argv[2];
const tag = { 's4-stall': 'STL', 's0-poisoned-row': 'PSN', 's5-gap-snapshot': 'GAP' }[name];
if (!tag) throw new Error(`unknown scenario ${name}`);
const r = new Report(name);
ensureWorkspace(WS, `st-${ST}`);
setWireRules([]);

const created = await createSession('public', WS, `UI_STREAM n=3 delay=0 tag=${tag}A`);
const session = created.session;
r.check('turn 1 completed', (await waitTurn(session)).status === 'COMPLETED', session);
for (let i = 0; i < 50 && snapshotCovered(session) < lastSeq(session); i++) await sleep(100);
const browser = await launch();
const arms = {};
for (const arm of ['base', 'head']) arms[arm] = await open(browser, { arm, session });
for (const arm of ['base', 'head']) await arms[arm].page.getByText(`[${tag}A-003]`).first().waitFor({ timeout: 20_000 });
const t0 = Date.now();
const wireMark = wireEntries().length;
const out = { session, arms: {} };

async function measure(label, n) {
  for (const arm of ['base', 'head']) {
    const { page, net, warnings } = arms[arm];
    const streams = streamCalls(net).filter((e) => e.t >= t0);
    const res = {
      markers: analyse(await markers(page, tag), n),
      alerts: await alertText(page),
      streamRequests: streams.length,
      cursors: streams.map((e) => e.body?.afterSequence),
      gapsMs: streams.slice(1).map((e, i) => e.t - streams[i].t),
      transcriptReloads: transcriptCalls(net).filter((e) => e.t >= t0).length,
      warnings: warnings.filter((x) => x.t >= t0 && /Managed Agent/.test(x.text)).map((x) => x.text.slice(0, 160)),
    };
    (out.arms[arm] ??= {})[label] = res;
    r.note(`${arm} [${label}]`, j(res));
  }
}
const waitMarker = async (marker, timeout = 30_000) => {
  for (const arm of ['base', 'head']) await arms[arm].page.getByText(marker).first().waitFor({ timeout });
};

if (name === 's4-stall') {
  // A broken intermediary prepends an id-less corrupt terminal frame to every stream response.
  setWireRules([{ kind: 'prefix', session, frame: 'event:turn.completed\ndata:{"type":"turn.compl\n\n' }]);
  await killStreams(session);
  const samples = { base: [], head: [] };
  for (let s = 0; s < 20; s++) {
    await sleep(1000);
    for (const arm of ['base', 'head']) samples[arm].push((await alertText(arms[arm].page)).join(' | ') || '-');
  }
  out.alertTimeline = samples;
  r.note('alert timeline base (1 s samples)', j(samples.base));
  r.note('alert timeline head (1 s samples)', j(samples.head));
  await measure('stalled 20 s', 0);
  for (const arm of ['base', 'head']) await shot(arms[arm].page, `${name}-${arm}-stalled`);
  // The intermediary recovers; the next turn must clear the error and render.
  setWireRules([]);
  await sleep(4000);
  await submit(session, `UI_STREAM n=5 delay=50 tag=${tag}`);
  r.check('turn 2 completed', (await waitTurn(session)).status === 'COMPLETED');
  await sleep(4000);
  await measure('after recovery + turn 2', 5);
  for (const arm of ['base', 'head']) await shot(arms[arm].page, `${name}-${arm}-recovered`);
}

if (name === 's0-poisoned-row') {
  await submit(session, `UI_STREAM n=40 delay=150 tag=${tag}`);
  await waitMarker(`[${tag}-010]`);
  setWireRules([{ kind: 'hold', path: '/events/stream$', bodyContains: session, ms: 15000, times: 2 }]);
  r.note('killed streams', String(await killStreams(session)));
  r.check('turn 2 completed', (await waitTurn(session, { timeoutMs: 60_000 })).status === 'COMPLETED');
  for (let i = 0; i < 50 && snapshotCovered(session) < lastSeq(session); i++) await sleep(100);
  const row = sql(`SELECT sequence_id, data_json FROM managed_agent_event WHERE session_id='${session}' AND data_json LIKE '%[${tag}-030]%'`)[0];
  out.poisoned = { sequence: row[0], original: row[1] };
  sql(`UPDATE managed_agent_event SET data_json='{"delta":"tru' WHERE session_id='${session}' AND sequence_id=${row[0]}`);
  r.note('poisoned store row', `sequence ${row[0]} data_json -> {"delta":"tru  (lastSequence ${lastSeq(session)}, snapshot covered ${snapshotCovered(session)})`);
  await sleep(26_000);
  const wire = wireEntries().slice(wireMark);
  const streamReqs = wire.filter((e) => e.kind === 'req' && e.path.endsWith('/events/stream') && e.body?.sessionId === session).map((e) => e.reqId);
  out.wireStreams = streamReqs.map((id) => ({ id, status: wire.find((e) => e.kind === 'res' && e.reqId === id)?.status, frames: wire.filter((e) => e.kind === 'frame' && e.reqId === id).length, end: wire.find((e) => e.kind === 'end' && e.reqId === id)?.reason }));
  r.note('wire: stream responses after the poisoning', j(out.wireStreams.slice(-8)));
  await measure('26 s after release', 40);
  for (const arm of ['base', 'head']) await shot(arms[arm].page, `${name}-${arm}-wedged`);
  const springLog = fs.readdirSync(`${RIG}/run/${DB}`).filter((f) => f.startsWith('spring-')).sort().at(-1);
  const log = fs.readFileSync(`${RIG}/run/${DB}/${springLog}`, 'utf8');
  out.serverErrors = (log.match(/Stored event is invalid/g) ?? []).length;
  r.note('server log "Stored event is invalid" count', String(out.serverErrors));
  // A full page reload: the transcript comes from the snapshot, the stream starts above the row.
  for (const arm of ['base', 'head']) {
    await arms[arm].page.reload({ waitUntil: 'load' });
    await arms[arm].page.getByText(`[${tag}A-003]`).first().waitFor({ timeout: 20_000 });
  }
  await sleep(3000);
  await measure('after full page reload', 40);
  sql(`UPDATE managed_agent_event SET data_json='${row[1].replace(/'/g, "''")}' WHERE session_id='${session}' AND sequence_id=${row[0]}`);
  r.check('store row restored', one(`SELECT data_json FROM managed_agent_event WHERE session_id='${session}' AND sequence_id=${row[0]}`) === row[1]);
}

if (name === 's5-gap-snapshot') {
  await submit(session, `UI_STREAM n=40 delay=150 tag=${tag}`);
  await waitMarker(`[${tag}-015]`);
  const seen = {};
  for (const arm of ['base', 'head']) seen[arm] = analyse(await markers(arms[arm].page, tag), 40).max;
  r.note('live markers when the connection dropped', j(seen));
  setWireRules([{ kind: 'hold', path: '/events/stream$', bodyContains: session, ms: 14000, times: 2 }]);
  r.note('killed streams', String(await killStreams(session)));
  r.check('turn 2 completed', (await waitTurn(session, { timeoutMs: 60_000 })).status === 'COMPLETED');
  for (let i = 0; i < 100 && snapshotCovered(session) < lastSeq(session); i++) await sleep(100);
  const covered = snapshotCovered(session);
  // What the server's own advanceReplayFloor would do (floor <= snapshot covered sequence); nothing calls it yet.
  sql(`UPDATE managed_agent_session SET replay_floor_sequence=${covered} WHERE session_id='${session}'`);
  r.note('replay floor raised', `floor=${covered} lastSequence=${lastSeq(session)}`);
  for (let i = 0; i < 60; i++) {
    const n = wireEntries().slice(wireMark).filter((e) => e.kind === 'frame' && e.event === 'agent.session.resync_required' && e.session === session).length;
    if (n >= 2) break;
    await sleep(500);
  }
  await sleep(4000);
  out.resyncFrames = wireEntries().slice(wireMark).filter((e) => e.kind === 'frame' && e.event === 'agent.session.resync_required' && e.session === session).length;
  r.check('the server sent resync_required to both arms', out.resyncFrames >= 2, String(out.resyncFrames));
  await measure('after the server gap', 40);
  for (const arm of ['base', 'head']) await shot(arms[arm].page, `${name}-${arm}-after-gap`);
  await submit(session, `UI_STREAM n=5 delay=20 tag=${tag}C`);
  r.check('turn 3 completed', (await waitTurn(session)).status === 'COMPLETED');
  let live = true;
  try {
    await waitMarker(`[${tag}C-005]`, 15_000);
  } catch {
    live = false;
  }
  r.check('both arms render turn 3 live after the gap', live);
  await measure('after turn 3', 40);
  sql(`UPDATE managed_agent_session SET replay_floor_sequence=0 WHERE session_id='${session}'`);
}

fs.writeFileSync(`${RIG}/out/${DB}/${name}-results.json`, JSON.stringify(out, null, 2));
setWireRules([]);
await browser.close();
r.done(out);
