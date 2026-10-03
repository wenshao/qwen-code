// VERIFICATION RIG ONLY (PR #13206): live corrupt-frame scenarios.
// Both arms (base = main, head = PR ⊕ main) watch the SAME Session at the same time, so they read
// identical bytes from the Java server; the wire corrupts the chosen frames for every reader.
// usage: node live.mjs <scenario>
import fs from 'node:fs';
import { api, createSession, waitTurn, submit, lastSeq, snapshotCovered, setWireRules, wireEntries, sql, sleep, Report, ensureWorkspace, WS, ST, RIG, DB, j } from './lib.mjs';
import { launch, open, markers, analyse, alertText, shot, streamCalls, transcriptCalls, rows } from './ui.mjs';

const SCENARIOS = {
  // A corrupt delta frame (truncated JSON) in the middle of a live turn, served again on every replay.
  's1-delta': { n: 30, delay: 120, rules: (s, t) => [{ kind: 'frame', session: s, contains: `[${t}-010]`, action: 'corrupt' }] },
  // The same delta with a payload that parses but is not an event object.
  's1b-delta-nonobject': { n: 30, delay: 120, rules: (s, t) => [{ kind: 'frame', session: s, contains: `[${t}-010]`, action: 'nonobject' }] },
  // The turn terminal frame is corrupt: a skip would leave the message streaming forever.
  's2-terminal': { n: 20, delay: 100, rules: (s) => [{ kind: 'frame', session: s, event: 'turn.completed', action: 'corrupt' }] },
  's2b-terminal-nonobject': { n: 20, delay: 100, rules: (s) => [{ kind: 'frame', session: s, event: 'turn.completed', action: 'nonobject' }] },
  's2c-terminal-nodata': { n: 20, delay: 100, rules: (s) => [{ kind: 'frame', session: s, event: 'turn.completed', action: 'nodata' }] },
  // A run of four consecutive corrupt delta frames: more than the budget of three.
  's3-run': { n: 30, delay: 120, rules: (s, t) => [11, 12, 13, 14].map((k) => ({ kind: 'frame', session: s, contains: `[${t}-0${k}]`, action: 'corrupt' })) },
  // A delta frame that lost its data line (id/event only) mid-stream.
  's3b-nodata': { n: 30, delay: 120, rules: (s, t) => [{ kind: 'frame', session: s, contains: `[${t}-010]`, action: 'nodata' }] },
};

const name = process.argv[2];
const sc = SCENARIOS[name];
if (!sc) throw new Error(`unknown scenario ${name}`);
const tag = name.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6);
const r = new Report(name);
ensureWorkspace(WS, `st-${ST}`);
setWireRules([]);

const created = await createSession('public', WS, `UI_STREAM n=3 delay=0 tag=${tag}A`);
r.check('session created', created.status === 201 || created.status === 202 || Boolean(created.session), `${created.status} ${created.session}`);
const session = created.session;
const t1 = await waitTurn(session);
r.check('first turn completed', t1.status === 'COMPLETED', j(t1));
for (let i = 0; i < 50 && snapshotCovered(session) < lastSeq(session); i++) await sleep(100);
r.note('after turn 1', `lastSequence=${lastSeq(session)} snapshotCovered=${snapshotCovered(session)}`);

const browser = await launch();
const arms = {};
for (const arm of ['base', 'head']) arms[arm] = await open(browser, { arm, session });
for (const arm of ['base', 'head']) {
  await arms[arm].page.getByText(`[${tag}A-003]`).first().waitFor({ timeout: 20_000 });
}
r.check('both arms show turn 1', true);
const before = lastSeq(session);
const wireMark = wireEntries().length;
setWireRules(sc.rules(session, tag));
const t0 = Date.now();
const sub = await submit(session, `UI_STREAM n=${sc.n} delay=${sc.delay} tag=${tag}`);
r.check('turn 2 admitted', sub.status === 202, `${sub.status}`);
const t2 = await waitTurn(session, { timeoutMs: 90_000 });
r.check('turn 2 completed on the server', t2.status === 'COMPLETED', j(t2));
// Watch long enough for the base arm's 3 s retry loop to show itself several times.
await sleep(12_000);
const after = lastSeq(session);
r.note('server sequences', `turn 2 = ${before + 1}..${after}`);
const wire = wireEntries().slice(wireMark);
const corrupted = wire.filter((e) => e.kind === 'frame' && e.action && e.session === session);
r.note('wire corrupted frames (all readers)', j(corrupted.map((e) => ({ req: e.reqId, id: e.id, event: e.event, action: e.action }))));
const resyncFrames = wire.filter((e) => e.kind === 'frame' && e.event === 'agent.session.resync_required');
r.note('server resync_required frames', String(resyncFrames.length));

const results = {};
for (const arm of ['base', 'head']) {
  const { page, net, warnings, errors } = arms[arm];
  const m = analyse(await markers(page, tag), sc.n);
  const alerts = await alertText(page);
  const streams = streamCalls(net).filter((e) => e.t >= t0);
  const transcripts = transcriptCalls(net).filter((e) => e.t >= t0);
  const cursors = streams.map((e) => e.body?.afterSequence);
  const gaps = streams.slice(1).map((e, i) => e.t - streams[i].t);
  const w = warnings.filter((x) => x.t >= t0 && /Managed Agent/.test(x.text)).map((x) => x.text.slice(0, 200));
  results[arm] = { markers: m, alerts, streamRequests: streams.length, cursors, gapsMs: gaps, transcriptReloads: transcripts.length, warnings: w, errors: errors.filter((x) => x.t >= t0).map((x) => x.text.slice(0, 200)), rowCount: (await rows(page)).length };
  r.note(`${arm}: markers`, j(m));
  r.note(`${arm}: alerts`, j(alerts));
  r.note(`${arm}: stream requests after submit`, `${streams.length} cursors=${j(cursors)} gapsMs=${j(gaps)}`);
  r.note(`${arm}: transcript reloads after submit`, String(transcripts.length));
  r.note(`${arm}: console warnings`, j(w));
  await shot(page, `${name}-${arm}-live`);
}
fs.writeFileSync(`${RIG}/out/${DB}/${name}-results.json`, JSON.stringify({ session, before, after, corrupted, resyncFrames: resyncFrames.length, results }, null, 2));

// Recovery by a full page reload (the only escape the base arm has).
setWireRules([]);
const reload = {};
for (const arm of ['base', 'head']) {
  const { page } = arms[arm];
  await page.reload({ waitUntil: 'load' });
  await page.getByText(`[${tag}A-003]`).first().waitFor({ timeout: 20_000 });
  await sleep(2500);
  reload[arm] = { markers: analyse(await markers(page, tag), sc.n), alerts: await alertText(page) };
  r.note(`${arm}: after full page reload`, j(reload[arm]));
}
fs.writeFileSync(`${RIG}/out/${DB}/${name}-results.json`, JSON.stringify({ session, before, after, corrupted, resyncFrames: resyncFrames.length, results, reload }, null, 2));
await browser.close();
r.done({ session, results, reload });
