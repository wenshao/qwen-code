// Round-3 evidence cards for PR 13621 (head dfb3bad48c). usage: node build-r3.mjs
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
const STACK = 'Spring fat jar (JDK 21.0.12) + native MySQL 8.4.7 + packaged Hosted Harness built from the same head + real Turns through the public API. head = dfb3bad48c (= PR + main e6e2c9efd1, the current main) · base = main e6e2c9efd1.';

// ---------- r3-01: claim re-run + fix gates ----------
{
  const arms = [['core-h3-on', 'head · flag ON'], ['core-h3-off', 'head · flag=false'], ['core-h3-default', 'head · flag unset'], ['core-b3-on', 'main · flag ON (env inert)']];
  const rows = [];
  for (const [n, label] of arms) {
    const r = R(n);
    for (const k of ['bound', 'unbound']) {
      const c = r.core[k];
      const sse = (x) => (x.resync.length ? '✔ 1 resync frame, 0 events' : `replays ${x.ids.length} (${x.ids[0]}..${x.ids.at(-1)})`);
      rows.push([`${label} · ${k}`, `0 → ${c.session.replay_floor_sequence} (snapshot ${c.windowAfter.snapshot})`, c.eventsAfter0.status === 409 ? `✔ 409 ${c.eventsAfter0.body.error.code}` : `200 · from seq ${c.eventsAfter0.body.first}`, sse(c.publicSseAfter0), sse(c.webShellSseAfter0), `${c.windowAfter.events}/${c.windowAfter.last}`]);
    }
    if (r.live) rows.push([`${label} · live stream`, `floors seen ${r.live.floorsSeenWhileAttached.join('→')}`, '—', `ids ${r.live.firstId}..${r.live.lastId} contiguous, resync 0`, '—', '—']);
    rows.push([`  checks`, `${r.summary.pass} pass / ${r.summary.fail} fail`, '', '', '', '']);
  }
  const rt = R('retract-h3-on').retract;
  const st = (o) => Object.entries(o).map(([k, v]) => `${k} ×${v}`).join(', ');
  render('r3-01-claim-and-gates', card({
    title: 'PR #13621 round 3 — central claim, R1-1 window and the new fix on head dfb3bad48c',
    sub: STACK,
    blocks: [
      { h: 'Two real Turns per Session, then reads over real HTTP/SSE', table: table(['Arm · Session', 'replay_floor_sequence', 'GET …/events?after=0', 'public SSE after=0', 'WebShell POST SSE after=0', 'events kept'], rows) },
      { h: 'R1-1: in-band retraction deletes the Snapshot above a raised floor (real Harness restart of a cut model attempt)', table: table(['Arm', 'model attempts / stream.reconciled', 'reads while floor > coverage', 'reads outside the window'], [['head dfb3bad48c', `${rt.modelAttempts} / ${rt.reconciledEvents.length}`, `✔ ${st(rt.windowStatuses)} (${(rt.windowMs / 1000).toFixed(1)} s rebuild)`, st(rt.outsideStatuses)]]) },
      { h: 'Fix commit 4fac2c7a19 (own scheduler) — gates on head', table: table(['Gate', 'Result'], [
        ['main code vs the round-2 candidate', '✔ identical (+13/−1); guard test reworded only'],
        ['ReplayFloor*Test · ManagedEventReplayTest · Issue13181QueryBudgetTest · ReplayFloorSchedulerTest', '✔ 49/49'],
        ['checkstyle:check', '✔ clean'],
        ['mutant: drop scheduler = "replayFloorScheduler"', '✔ killed — ReplayFloorSchedulerTest fails (expected "replayFloorScheduler")'],
        ['mutant: rename the replayFloorScheduler bean', '✔ killed — ReplayFloorAdvancerTest 7/7 errors: No bean named \'replayFloorScheduler\''],
        ['merge dfb3bad48c conflict resolution', '✔ both replayFloorScheduler and childRelayScheduler beans kept; OpenAPI 1.36.0 keeps main\'s v1.35 clause and renumbers the PR\'s clause v1.34 → v1.36'],
        ['jcmd on head', '✔ threads "scheduling-1" + "replay-floor-1"; ReplayFloorAdvancer.advance only ever seen on replay-floor-1'],
      ]) },
      { note: 'Same outcome as round 2 on the new head: the floor moves only with the flag ON, cursors below it get the D3 contract on all three read surfaces, nothing is deleted, and the R1-1 guard keeps readers served while a retraction rebuilds the Snapshot. The merged main (H4b child runtime, workspace roles, H5b/H5c channels, V53–V55) migrates and runs underneath without interaction: the channel runtime keeps its own cursors and never reads Session events.' },
    ],
  }));
}

// ---------- r3-02: F1 fixed on the PR head ----------
{
  const h3 = R('scale-h3').scaleProbe, on2 = R('scale-on2').scaleProbe;
  const lag = (p) => (p.snapshotLagMs === null ? '✖ not caught up after 600 s (timeout)' : `${(p.snapshotLagMs / 1000).toFixed(p.snapshotLagMs >= 10000 ? 0 : 2)} s`);
  const rowsOf = (s, idx) => s.probes.filter((_, i) => idx.includes(i)).map((p) => [`+${(p.t / 1000).toFixed(0)} s`, `${p.pendingFloorsAtStart.toLocaleString()}`, `${(p.turnMs / 1000).toFixed(1)} s`, lag(p)]);
  const lags = h3.probes.map((p) => p.snapshotLagMs), turns = h3.probes.map((p) => p.turnMs);
  const th = R('scale-h3')['threads-during-pass'];
  render('r3-02-first-opt-in-fixed', card({
    title: 'PR #13621 round 3 — F1 fixed on the PR head: the first opt-in pass no longer starves the materializer',
    sub: 'Same MySQL 8.4.7 database as round 2: 100,000 existing Sessions with a Snapshot, every floor reset to 0 (a first opt-in). Spring restarted with the flag ON; the database also migrated V53→V55 on this boot. A probe Session runs a real 5-delta Turn every ~2.7 s while the pass drains.',
    blocks: [
      { h: 'Round 2 · head 447acf40a7 (pass on the shared one-thread scheduler) · host load 15–30', table: table(['probe at', 'floors still at 0', 'Turn wall time', 'Snapshot catch-up after the Turn'], rowsOf(on2, [0, 1, 2])) },
      { h: 'Round 3 · head dfb3bad48c (pass on replay-floor-1) · host load 12–20', table: table(['probe at', 'floors still at 0', 'Turn wall time', 'Snapshot catch-up after the Turn'], rowsOf(h3, [0, 1, 3, 5, 8, 11])) },
      { cap: `All 12 probes during the pass: Snapshot catch-up ${Math.min(...lags)}–${Math.max(...lags)} ms, Turns ${(Math.min(...turns) / 1000).toFixed(2)}–${(Math.max(...turns) / 1000).toFixed(2)} s, while the pass advanced ${(h3.probes[0].pendingFloorsAtStart - h3.probes.at(-1).pendingFloorsAtStart).toLocaleString()} floors. jcmd during the pass: ${th.schedulingThreads.join(', ')}; inside ReplayFloorAdvancer.advance: ${th.threadsInAdvance.join(', ')}.` },
      { note: 'The F1 stall reproduced in round 2 is gone on the actual PR head, not only in the candidate build. The pass itself is unchanged (still O(N²/64) scanning on first enable, deferred to a follow-up by the author), but it now runs on its own thread, so Items/Snapshot materialization and the recovery ticks keep their cadence.' },
    ],
  }));
}

// ---------- r3-03: WebShell real browser on the new head ----------
{
  const on = J('webshell-blip-h3-on/result.json'), off = J('webshell-blip-h3-off/result.json');
  const trace = (name) => {
    const w = J(`${name}/wire.json`);
    const i = w.findIndex((e) => e.kind === 'CUT');
    const t0 = w[i].t;
    const fmt = (e) => {
      const t = `+${((e.t - t0) / 1000).toFixed(1)}s`.padEnd(8);
      if (e.kind === 'CUT') return `${t}network cut (browser connections reset, new ones refused)`;
      if (e.kind === 'RESTORE') return `${t}network restored`;
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
    title: 'PR #13621 round 3 — WebShell Managed panel in a real browser on head dfb3bad48c',
    sub: 'Chromium (Playwright) on the Web Shell Vite dev server built from the same head (managedProvider=java) → Spring + Hosted Harness + real model qwen3.8-max. Turn 1 from the page; browser↔server path cut; Turn 2 through the public API; floor passes the page cursor (7 → 13); path restored.',
    blocks: [{ h: `Flag ON — after restore (Turn 2 rendered ${on.turn2RenderedMsAfterRestore} ms after the network came back; no error banner)` }],
  }).replace('</div></body>', `${img('../runs/webshell-blip-h3-on/03-after-restore.png', 322, 96, 1030, 420)}<h2>Wire, flag ON (floor ${on.windowBeforeRestore.floor} > page cursor ${on.clientCursorAtCut})</h2><pre>${esc(trace('webshell-blip-h3-on'))}</pre><h2>Wire, flag OFF control (floor ${off.windowBeforeRestore.floor})</h2><pre>${esc(trace('webshell-blip-h3-off'))}</pre><div class="note">Unchanged from round 2 on the merged code: with the flag ON the stale cursor gets one resync frame, the shipped client reloads the transcript and resumes after 13; with it OFF the same page catches up by replaying 8..13. Both pages show both replies (ON: ${on.pageShowsBothReplies}, OFF: ${off.pageShowsBothReplies}); public after=0 afterwards: ON ${on.publicAfter0.status} ${on.publicAfter0.code}, OFF ${off.publicAfter0.status}.</div></div></body>`);
  render('r3-03-webshell-resync', html);
}
