// Builds the PR 13621 evidence cards from runs/*/ and renders PNGs.
// usage: node build.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { card, esc, table } from './card.mjs';

const RIG = '/Users/wenshao/pr13621-rig';
const FIG = `${RIG}/fig`;
const R = (name) => JSON.parse(readFileSync(`${RIG}/runs/${name}/results.json`, 'utf8'));
const J = (p) => JSON.parse(readFileSync(`${RIG}/runs/${p}`, 'utf8'));
const render = (name, html, width = 1600) => {
  writeFileSync(`${FIG}/${name}.html`, html);
  execFileSync('node', [`${FIG}/render.mjs`, `${FIG}/${name}.html`, `${FIG}/${name}.png`, String(width)], { stdio: 'inherit' });
};
const STACK = 'Real stack per arm: Spring Managed Agent Server fat jar (JDK 21.0.12) + native MySQL 8.4.7 + packaged Hosted Harness (dist/cli.js serve --profile hosted-harness) + real Turns through the public API. head = 447acf40a7 · base = merge-base 2e962b6121 · merge = trial merge 4ba2166f63 with main 669b2f0f91.';

// ---------- Figure 1: central claim across five arms ----------
{
  const arms = [
    ['core-head-on', 'head · flag ON'],
    ['core-merge-on', 'merge · flag ON'],
    ['core-head-off', 'head · flag=false'],
    ['core-head-default', 'head · flag unset'],
    ['core-base-on', 'base · flag ON (env inert)'],
  ];
  const rows = [];
  for (const [n, label] of arms) {
    const r = R(n);
    for (const k of ['bound', 'unbound']) {
      const c = r.core[k];
      const ps = c.publicSseAfter0, ws = c.webShellSseAfter0;
      const sse = (x) => (x.resync.length ? `✔ 1 resync frame, 0 events` : `replays ${x.ids.length} events (${x.ids[0]}..${x.ids.at(-1)})`);
      rows.push([
        `${label} · ${k}`,
        `0 → ${c.session.replay_floor_sequence} (snapshot ${c.windowAfter.snapshot}, last ${c.windowAfter.last})`,
        c.eventsAfter0.status === 409 ? `✔ 409 ${c.eventsAfter0.body.error.code}` : `200 · from seq ${c.eventsAfter0.body.first}`,
        sse(ps),
        sse(ws),
        `${c.windowAfter.events}/${c.windowAfter.last}`,
      ]);
    }
    if (r.live) rows.push([`${label} · live stream during Turn 3`, `floors seen ${r.live.floorsSeenWhileAttached.join('→')}`, '—', `ids ${r.live.firstId}..${r.live.lastId} contiguous, resync 0`, '—', '—']);
    rows.push([`  checks ${label}`, `${r.summary.pass} pass / ${r.summary.fail} fail`, '', '', '', '']);
  }
  render('01-central-claim', card({
    title: 'PR #13621 — replay floor on the real stack: only head/merge with the flag ON advance it',
    sub: STACK,
    blocks: [
      { h: 'Two real Turns per Session (fake OpenAI model), then reads over real HTTP/SSE', table: table(['Arm · Session', 'replay_floor_sequence', 'GET …/events?after=0', 'public SSE after=0', 'WebShell POST SSE after=0', 'events kept'], rows) },
      { note: 'Flag ON: the floor rises to the Snapshot coverage after real Turns; a cursor below it gets 409 cursor_expired carrying the floor and coverage, both SSE surfaces send exactly one agent.session.resync_required frame (no id) and close, a cursor at the floor gets 200, Items→resume and WebShell transcript→resume work, and a stream attached at the floor receives a whole live Turn contiguously while the floor advances behind it. Flag false / unset / base jar: floor stays 0 and every read replays from sequence 1. No event row is ever deleted.' },
    ],
  }));
}

// ---------- Figure 2: WebShell in a real browser ----------
{
  const on = J('webshell-blip-on/result.json'), off = J('webshell-blip-off/result.json');
  const trace = (name) => {
    const w = J(`${name}/wire.json`);
    const i = w.findIndex((e) => e.kind === 'CUT');
    const t0 = w[i].t;
    const fmt = (e) => {
      const t = `+${((e.t - t0) / 1000).toFixed(1)}s`.padEnd(8);
      if (e.kind === 'CUT') return `${t}network cut (browser connections reset, new ones refused)`;
      if (e.kind === 'RESTORE') return `${t}network restored`;
      if (e.kind === 'refused') return null;
      if (e.kind === 'stream-request') return `${t}POST /events/stream  afterSequence=${e.afterSequence}`;
      if (e.kind === 'resync-frame') return `${t}  ← event: agent.session.resync_required  replayFloorSequence=${e.data.replayFloorSequence} snapshotThroughSequence=${e.data.snapshotThroughSequence}`;
      if (e.kind === 'transcript-request') return `${t}POST /transcript/query  (reload)`;
      if (e.kind === 'transcript-response') return `${t}  ← transcript coveredSequence=${e.coveredSequence} lastSequence=${e.lastSequence}`;
      if (e.kind === 'event-ids') return `${t}  ← events id ${e.from}..${e.to}`;
      return null;
    };
    const refused = w.slice(i).filter((e) => e.kind === 'refused').length;
    const lines = w.slice(i).map(fmt).filter(Boolean);
    lines.splice(1, 0, `        (${refused} reconnect attempts refused while cut; Turn 2 ran via the API meanwhile)`);
    return lines.join('\n');
  };
  const img = (p, x, y, w, h) => `<div style="width:${w}px;height:${h}px;overflow:hidden;border:1px solid #30363d;border-radius:6px;margin:6px 0"><img src="${p}" style="width:1360px;margin-left:-${x}px;margin-top:-${y}px"></div>`;
  const html = card({
    title: 'PR #13621 — WebShell Managed panel in a real browser: a page left below the raised floor resyncs and shows the missed Turn',
    sub: `Chromium (Playwright) on the Web Shell Vite dev server (managedProvider=java) → Spring head 447acf40a7 + Hosted Harness + real model qwen3.8-max. Turn 1 sent from the page; the browser↔server path is cut; Turn 2 is sent through the public API; the floor passes the page's cursor (7 → 13); the path is restored.`,
    blocks: [
      { h: `Flag ON — after restore (Turn 2 reply rendered ${on.turn2RenderedMsAfterRestore} ms after the network came back; no error banner)`, cap: '' },
    ],
  }).replace('</div></body>', `${img('../runs/webshell-blip-on/03-after-restore.png', 322, 96, 1030, 420)}<h2>Wire, flag ON (floor ${on.windowBeforeRestore.floor} > page cursor ${on.clientCursorAtCut})</h2><pre>${esc(trace('webshell-blip-on'))}</pre><h2>Wire, flag OFF control (floor ${off.windowBeforeRestore.floor}) — same page outcome by plain replay</h2><pre>${esc(trace('webshell-blip-off'))}</pre><div class="note">Both arms end with both replies on the page (flag ON: ${on.pageShowsBothReplies}, OFF: ${off.pageShowsBothReplies}) and no stall banner. With the flag ON the server refuses the stale cursor with one resync frame, the client reloads the transcript (covered 13) and resumes after 13 — the D3 contract firing from a production caller and handled by the shipped client. Public GET …/events?after=0 on that Session afterwards: ${on.publicAfter0.status} ${on.publicAfter0.code}.</div></div></body>`);
  render('02-webshell-resync', html);
}

// ---------- Figure 3: R1-1 window (in-band retraction deletes the Snapshot) ----------
function timeline(samples, { w = 1460, h = 220, title }) {
  const start = samples.findIndex((s) => s.snapshot < s.floor);
  const t0 = samples[Math.max(0, start - 10)].t;
  const xs = samples.map((s) => (s.t - t0) / 1000);
  const xMax = Math.max(...xs);
  const yMax = Math.max(...samples.map((s) => Math.max(s.floor, s.snapshot, s.last))) * 1.05;
  const X = (x) => 60 + (x / xMax) * (w - 110), Y = (y) => h - 30 - (Math.max(y, 0) / yMax) * (h - 60);
  const line = (key, color) => `<polyline fill="none" stroke="${color}" stroke-width="2" points="${samples.map((s, i) => `${X(xs[i]).toFixed(1)},${Y(s[key]).toFixed(1)}`).join(' ')}"/>`;
  const dots = samples.map((s, i) => `<circle cx="${X(xs[i]).toFixed(1)}" cy="${h - 12}" r="2.4" fill="${s.status === 200 ? '#3fb950' : '#f85149'}"/>`).join('');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => `<text x="${X(f * xMax)}" y="${h + 4}" fill="#8b949e" font-size="12">${(f * xMax).toFixed(0)} s</text>`).join('');
  return `<svg width="${w}" height="${h + 10}" style="background:#0d1117"><text x="60" y="16" fill="#e6edf3" font-size="14">${esc(title)}</text>${line('floor', '#d29922')}${line('snapshot', '#79c0ff')}${dots}${ticks}<text x="${w - 380}" y="16" fill="#d29922" font-size="13">— replay_floor_sequence</text><text x="${w - 210}" y="16" fill="#79c0ff" font-size="13">— Snapshot coverage</text><text x="4" y="${h - 8}" fill="#8b949e" font-size="11">after=0</text></svg>`;
}
{
  const head = R('retract-head-on').retract, nofix = R('retract-nofix-on').retract;
  const sh = J('retract-head-on/retract-samples.json'), sn = J('retract-nofix-on/retract-samples.json');
  const st = (o) => Object.entries(o).map(([k, v]) => `${k} ×${v}`).join(', ');
  render('03-retraction-window', card({
    title: 'PR #13621 — R1-1 on the real stack: in-band retraction deletes the Snapshot above a raised floor',
    sub: `Workspace-bound Session, 2 history Turns × 1500 deltas (floor raised to ~3011), then a Turn whose first model attempt is cut mid-message: the Harness restarts the attempt and journals message.retracted (#13319); Spring retracts, deletes the Snapshot and rebuilds it from sequence 0. GET …/events?after=0&limit=1 polled every 20 ms (dots: green 200, red 409).`,
    blocks: [
      { svg: timeline(sh, { title: `head 447acf40a7 (guard: floor <= snapshot_through_sequence) — ${head.windowSamples} reads during the ${(head.windowMs / 1000).toFixed(1)} s rebuild` }) },
      { svg: timeline(sn, { title: `head with the R1-1 guard reverted — ${nofix.windowSamples} reads during the ${(nofix.windowMs / 1000).toFixed(1)} s rebuild` }) },
      { table: table(['Arm', 'model attempts / stream.reconciled', 'reads while floor > coverage', 'reads outside the window', '409 body during window'], [
        ['head', `${head.modelAttempts} / ${head.reconciledEvents.length}`, `✔ ${st(head.windowStatuses)}`, st(head.outsideStatuses), '— (served)'],
        ['guard reverted', `${nofix.modelAttempts} / ${nofix.reconciledEvents.length}`, `✖ ${st(nofix.windowStatuses)}`, st(nofix.outsideStatuses), `replay_floor_sequence ${nofix.window409Details[0].floor}, snapshot_through_sequence ${nofix.window409Details[0].snapshotThrough}`],
      ]) },
      { note: 'The second commit (fc239f11cd) is load-bearing in a real deployment, not only in the unit test: without it every reader below the floor is told to resync from a Snapshot that does not exist (snapshot_through_sequence 0) for the whole rebuild; with it they are served from the retained events and expiry resumes as soon as the rebuilt Snapshot backs the floor again. Event rows: none deleted in either arm.' },
    ],
  }));
}

// ---------- Figure 4: first opt-in on a populated deployment ----------
{
  const on2 = R('scale-on2').scaleProbe, on1 = R('scale-on').scaleProbe, k10 = R('scale10k-on').scaleProbe, cand = R('scale-cand').scaleProbe, off = R('scale-off').scaleProbe;
  const lag = (p) => (p.snapshotLagMs === null ? '✖ not caught up after 600 s (timeout)' : `${(p.snapshotLagMs / 1000).toFixed(p.snapshotLagMs >= 10000 ? 0 : 2)} s`);
  const rowsOf = (s, n = 3) => s.probes.slice(0, n).map((p) => [`+${(p.t / 1000).toFixed(0)} s`, `${p.pendingFloorsAtStart.toLocaleString()}`, `${(p.turnMs / 1000).toFixed(1)} s`, lag(p)]);
  const candLags = cand.probes.map((p) => p.snapshotLagMs);
  const offLags = off.probes.map((p) => p.snapshotLagMs);
  render('04-first-opt-in-stall', card({
    title: 'PR #13621 — first opt-in on a populated deployment: the drain pass holds the one shared scheduling thread',
    sub: 'MySQL 8.4.7 with 100,000 (and 10,000) Sessions that already have a Snapshot and floor 0, i.e. any deployment that existed before this PR. Spring restarted with QWEN_MANAGED_AGENT_REPLAY_FLOOR_ENABLED=true (default 60 s interval: the first pass starts at boot). A probe Session runs a real 5-delta Turn and we time how long its Snapshot (Items API) takes to catch up.',
    blocks: [
      { h: 'head 447acf40a7 · 100k Sessions · host load 15–30', table: table(['probe at', 'floors still at 0', 'Turn wall time', 'Snapshot catch-up after the Turn'], rowsOf(on2)) },
      { cap: `Pass length ≈ 16 min 14 s (boot 08:46:23 → probe 1's Snapshot lands 09:02:37). 1,558 target scans (sort of all 100k sessions each, avg 381 ms) + 100k advance transactions. jcmd: the only "scheduling-1" thread sits in ReplayFloorAdvancer.advance → advanceReplayFloor; MessageMaterializer cannot run until the pass returns. Same run at host load 60–120: ≈ 26 min 32 s, two probes timed out at 600 s, the third caught up after 379 s.` },
      { h: '10k Sessions · host load ~90', cap: `Pass ≈ 2 min 43 s. The probe Turn's first dispatch hit a transient Harness error (DaemonHttpException, retry scheduled +1 s); HarnessCoordinator.recoverExpiredTurns shares the same thread, so the retry ran only when the pass ended: Turn wall time ${(k10.probes[0].turnMs / 1000).toFixed(0)} s.` },
      { h: 'Candidate: same 100k first pass, ReplayFloorAdvancer on its own 1-thread scheduler (+13/−1 main code, plus a 23-line guard test)', table: table(['probe at', 'floors still at 0', 'Turn wall time', 'Snapshot catch-up after the Turn'], rowsOf(cand, 12).filter((_, i) => [0, 1, 2, 5, 8, 11].includes(i))) },
      { cap: `All 12 candidate probes during the pass: ${Math.min(...candLags)}–${Math.max(...candLags)} ms (flag-off control on the same DB at load ~120: ${Math.min(...offLags)}–${Math.max(...offLags)} ms). Thread dump: "replay-floor-1" in findReplayFloorTargets, "scheduling-1" free. PR tests 18/18 + new guard test green, Checkstyle clean; reverting the scheduler attribute fails the guard test.` },
      { note: 'Default deployments are unaffected (flag off). But the first time an operator opts in on an existing deployment, the pass freezes Items/Snapshot materialization and every recovery tick (Turn re-dispatch, Action delivery, lifecycle operations) for the whole first pass — minutes at 10k Sessions, a quarter hour or more at 100k. The bounded single-batch pass the triage review assessed became an unbounded drain in 6be39a9a34 (R3-1). Main already moved childRelayScheduler off the shared pool for the same reason (#13550).' },
    ],
  }));
}
