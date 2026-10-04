// Round-2 evidence cards (head 5cd1c832f4). Reads results/ (round 2) and results-r1/ (round 1).
import fs from 'node:fs';
import { createRequire } from 'node:module';

const RIG = '/Users/wenshao/pr13214-rig';
const R = (f) => JSON.parse(fs.readFileSync(`${RIG}/results/${f}.json`, 'utf8'));
const R1 = (f) => JSON.parse(fs.readFileSync(`${RIG}/results-r1/${f}.json`, 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const css = fs.readFileSync(`${RIG}/fig/gen.mjs`, 'utf8').match(/const css = `([\s\S]*?)`;/)[1];
const page = (title, sub, body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div></body></html>`;
const cards = {};
const G = (s) => `<span class="good">${s}</span>`;
const B = (s) => `<span class="bad">${s}</span>`;
const W = (s) => `<span class="warn">${s}</span>`;

// 06 round-2 delta
{
  const race = (r, f) => `${r(f).contradictions}/${r(f).rounds}`;
  const rel = (r, f) => { const v = r(f).find((x) => x.step === 'release').value; return v.status === 200 ? `200 released=${v.body.released}` : `${v.status} ${v.body.code}`; };
  const stall = (r, f) => r(f).final.h2.split('\t').slice(0, 2).filter((x) => x !== '-').join(' / ');
  const lc = (r, f) => { const s = r(f); return s.workerGoneAt != null ? `gone +${(s.workerGoneAt - s.signalAt).toFixed(1)} s` : 'survives'; };
  const le = (r, f) => { const s = r(f); return s.goneAfterMs != null ? `gone +${(s.goneAfterMs / 1000).toFixed(1)} s` : 'orphaned'; };
  const lost = (r, f) => r(f).warms.map((w) => `${w.status}`).join(' → ');
  const poll = (r, f) => { const s = r(f).mcpSession; return `${Object.values(s.clientRequests).at(-1)} / ${s.workerCalls.status}`; };
  const rows = [
    ['Cross-process race, 300 rounds (contradictions)', B(race(R1, 'race-base-l0')), G(race(R1, 'race-head-l0')), G(race(R, 'race-head-l0'))],
    ['… with +5 ms per DB hop, 200 rounds', B(race(R1, 'race-base-l5')), G(race(R1, 'race-head-l5')), G(race(R, 'race-head-l5'))],
    ['R3-1: release over seeded RELEASING + PREPARED', G(rel(R1, 'r31-base')), B(rel(R1, 'r31-head')), G(rel(R, 'r31-head'))],
    ['… idle RELEASING row (idempotent retry)', '—', rel(R1, 'r31-head-noexec'), G(rel(R, 'r31-head-noexec'))],
    ['Renewal stall, 1 parked row: healthy execution', B(stall(R1, 'stall-base-s1')), G(stall(R1, 'stall-head-s1')), G(stall(R, 'stall-head-s1'))],
    ['Renewal stall, 2 parked rows: healthy execution', '—', W(stall(R1, 'stall-head-s2')), W(stall(R, 'stall-head-s2'))],
    ['Spring SIGTERM, worker frozen', B(lc(R1, 'lifecycle-base-wedged')), G(lc(R1, 'lifecycle-head-wedged')), G(lc(R, 'lifecycle-head-wedged'))],
    ['Library JVM SIGTERM, healthy / handshake worker', B(`${le(R1, 'libexit-base-healthy')} / outlives`), G(`${le(R1, 'libexit-head-healthy')} / ${le(R1, 'libexit-head-handshake')}`), G(`${le(R, 'libexit-head-healthy')} / ${le(R, 'libexit-head-handshake')}`)],
    ['LOST reclaim, 303 sessions (warm answers)', B(lost(R1, 'lost-base-303')), G(lost(R1, 'lost-head-303')), G(lost(R, 'lost-head-303'))],
    ['Shipped MCP poller, 20 s (GETs / worker status)', poll(R, 'poll-base'), W(poll(R1, 'poll-head')), W(poll(R, 'poll-head'))],
  ];
  let t = '<table><tr><th>scenario (real MySQL 8.4.7, real bundled worker)</th><th>base 5130c1a734</th><th>round 1 · af6691ce1f</th><th>round 2 · 5cd1c832f4</th></tr>';
  for (const [n, a, b, c] of rows) t += `<tr><td>${n}</td><td class="mono">${a}</td><td class="mono">${b}</td><td class="mono">${c}</td></tr>`;
  t += '</table>';
  const sm = R('spring-matrix-head');
  const port = sm.find((x) => x.name === 'PORT=70000');
  const def = sm.find((x) => x.name.startsWith('default'));
  t += `<h2>Spring startup matrix (14 cases × 3 arms) — same posture as round 1, plus</h2><pre>default        ${esc(def.broker)}
PORT=70000     head:    ${esc(port.listenerMsg)}
               round 1: Runtime Broker listener could not start          (cause only in the stack trace)</pre>`;
  t += '<div class="note">Every round-1 scenario was re-run against the new head on the same rig (base unchanged, so its numbers carry over; the shipped-poller row for base was re-run back to back with head). R3-1 is closed with exactly the round-1 candidate\'s check, and the idle retry stays idempotent. The two-parked-rows bound and the unchanged <code>reconcile=true</code> fan-out are now stated in the design doc and tracked in #13275. Suites: runtime-broker 635 tests, 0 failures (2 skipped), SpotBugs 0, Checkstyle 0; MySQL IT profile 7/7 on a fresh database; managed-agent-server fix-adjacent 19/19.</div>';
  cards['06-round2-rerun'] = page('Round 2 — every real-stack scenario re-run on 5cd1c832f4', 'base vs round-1 head vs new head · 10 new commits, no main merge (merge-base still 5130c1a734)', t);
}

// 07 grace window
{
  const g = (a, m) => R(`grace-${a}-${m}`);
  const cell = (s) => {
    if (s.goneAfterMs != null) return G(`killed at +${(s.goneAfterMs / 1000).toFixed(2)} s`);
    const st = s.samples.at(-1).workers[0];
    return B(st.startsWith('1 ') ? 'orphaned (ppid 1) after Broker exit' : 'still running under the Broker at +9.5 s');
  };
  let t = '<table><tr><th>released worker ignores SIGTERM</th><th>base</th><th>round 1 · af6691ce1f</th><th>round 2 · 5cd1c832f4</th></tr>';
  t += `<tr><td>Broker keeps running</td><td class="mono">${cell(g('base', 'stay'))}</td><td class="mono">${cell(g('r1head', 'stay'))}</td><td class="mono">${cell(g('head', 'stay'))}</td></tr>`;
  t += `<tr><td>Broker JVM gets SIGTERM inside the 5 s grace window</td><td class="mono">${cell(g('base', 'exit'))}</td><td class="mono">${cell(g('r1head', 'exit'))}</td><td class="mono">${cell(g('head', 'exit'))}</td></tr></table>`;
  t += `<pre>worker   = real bundled worker, launched as: node --import ignore-term.mjs dist/cli.js managed-runtime-worker
           (preload installs a no-op SIGTERM listener and drops any the worker adds — a wedged graceful shutdown)
release  = the proxy drops the service's attestation reply → provisioning fails → releaseQuietly → provisioner.stop()
           (the first attestation, inside the provisioner's own handshake, is passed through)</pre>`;
  t += '<div class="note good">56c209634b moves a released worker into the tracked set until its escalation finishes. Round 1 already escalated while the Broker stayed up, but a JVM exit inside the grace window killed the daemon escalation thread and left the worker orphaned; round 2 kills it from the exit hook at the end of the same grace window.</div>';
  cards['07-release-grace-window'] = page('Release grace window — a released, SIGTERM-ignoring real worker', 'New in round 2 (56c209634b): the exit hook now also covers a worker between release and forced kill', t);
}

// 08 InnoDB statement order
{
  const mutPatch = fs.readFileSync(`${RIG}/mutant-m1.patch`, 'utf8').split('\n');
  const ms = mutPatch.findIndex((l) => l.startsWith('@@'));
  const mhunk = mutPatch.slice(ms, ms + 12).map((l) => (l.startsWith('+') ? `<span class="bad">${esc(l)}</span>` : esc(l))).join('\n');
  const race = R('race-mut-l0');
  const order = fs.readFileSync(`${RIG}/logs/order.status`, 'utf8').trim().split('\n');
  const maria = fs.readFileSync(`${RIG}/logs/order-maria.status`, 'utf8').trim().split('\n');
  const count = (lines, re, ok) => lines.filter((l) => re.test(l) && l.includes(ok ? 'exit=0' : 'exit=1')).length;
  let t = `<h2>Mutant M1 — the read-ahead the new comment in <code>JdbcRuntimeBindingRepository.beginSessionRelease</code> warns about</h2><pre>${mhunk}</pre>`;
  t += `<table><tr><th>oracle</th><th>head 5cd1c832f4</th><th>mutant M1</th></tr>
<tr><td>Two-JVM release-vs-admission race, real MySQL 8.4.7, 300 rounds</td><td class="mono good">0 contradictions</td><td class="mono bad">${race.contradictions} contradictions</td></tr>
<tr><td>runtime-broker unit suite (H2 MySQL mode), incl. the 200-round stress</td><td class="mono">635 / 0 failures</td><td class="mono bad">635 / 0 failures — survives</td></tr>
<tr><td>existing <code>mysql-integration</code> IT profile (single-threaded contract)</td><td class="mono">7 / 7</td><td class="mono bad">7 / 7 — survives</td></tr>
<tr><td>candidate IT <code>releaseTransitionSeesAnAdmissionThatCommittedWhileItWaited</code> · MySQL 8.4.7</td><td class="mono good">${count(order, /^head/, true)} / ${order.filter((l) => /^head/.test(l)).length} green</td><td class="mono good">${count(order, /^mut/, false)} / ${order.filter((l) => /^mut/.test(l)).length} red</td></tr>
<tr><td>same candidate IT · MariaDB 10.11.18 (the CI <code>mysql-integration</code> image)</td><td class="mono good">${count(maria, /^head/, true)} / ${maria.filter((l) => /^head/.test(l)).length} green</td><td class="mono good">${count(maria, /^mut/, false)} / ${maria.filter((l) => /^mut/.test(l)).length} red</td></tr></table>`;
  t += `<pre>candidate IT (68 lines, JdbcRuntimeBrokerMySqlIT): a holder connection takes the Session row lock FOR UPDATE;
  the admission (fixture.prepare) queues on it first, then beginSessionRelease queues behind it — both confirmed
  as 'LOCK WAIT' in information_schema.innodb_trx for this schema — then the holder commits.
  expect: admission PREPARED, release 409 runtime_session_busy, Session still READY.
  M1 fails with: Expected ExecutionException to be thrown, but nothing was thrown  (release went RELEASING)</pre>`;
  t += '<div class="note">The order the comment calls load-bearing is right, and the shipped code follows it — but nothing that runs in CI pins it: H2 does not reproduce InnoDB\'s first-consistent-read snapshot, and the existing MySQL IT only drives the transition single-threaded. The candidate makes the interleaving deterministic with two queued lock waits and runs in the existing CI MariaDB job. Suggestion, not a blocker.</div>';
  cards['08-innodb-statement-order'] = page('The InnoDB statement order the fix depends on is not pinned by any test', 'Mutation check on 5cd1c832f4: one consistent read moved ahead of the row lock reopens the race on InnoDB and survives every existing test', t);
}

const require = createRequire('/Users/wenshao/git/qwen-code-x9/package.json');
const { chromium } = require('playwright');
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1280, height: 900 } });
for (const [name, html] of Object.entries(cards)) {
  const file = `${RIG}/fig/${name}.html`;
  fs.writeFileSync(file, html);
  const p = await ctx.newPage();
  await p.goto('file://' + file);
  const clipped = await p.evaluate(() => [...document.querySelectorAll('pre,td')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  await p.locator('#card').screenshot({ path: `${RIG}/fig/${name}.png` });
  console.log(name, 'clipped elements:', clipped);
  await p.close();
}
await browser.close();
