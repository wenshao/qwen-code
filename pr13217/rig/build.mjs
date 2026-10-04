// Builds the PR 13217 evidence cards from runs/*/results.json and renders PNGs.
// usage: node build.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { card, esc, table } from './card.mjs';

const RIG = '/Users/wenshao/pr13217-rig';
const FIG = `${RIG}/fig`;
const R = (name) => JSON.parse(readFileSync(`${RIG}/runs/${name}/results.json`, 'utf8'));
const has = (name) => existsSync(`${RIG}/runs/${name}/results.json`);
const render = (name, html, width = 1600) => {
  writeFileSync(`${FIG}/${name}.html`, html);
  execFileSync('node', [`${FIG}/render.mjs`, `${FIG}/${name}.html`, `${FIG}/${name}.png`, String(width)], { stdio: 'inherit' });
};
const mb = (b) => `${(b / 1048576).toFixed(1)} MiB`;
const x = (a, b) => (b === 0 ? '∞' : `${(a / b).toFixed(a / b >= 10 ? 0 : 1)}×`);
const STACK =
  'Real stack per arm: Spring Managed Agent Server fat jar (JDK 21.0.12, embedded Runtime Broker) + native MySQL 8.4.7 (performance_schema + ROW binlog) + packaged Hosted Harness `dist/cli.js serve --profile hosted-harness` + fake OpenAI model. All traffic through the public / WebShell HTTP APIs; database work read from performance_schema (per schema) and the binary log (per table), never from the application. main = 6136786c0c · PR = trial merge 8136a6be2c (PR head 4d3b1351c7 + main).';

const main = R('ab-main');
const pr = R('ab-pr');
const pr0 = has('ab-pr0') ? R('ab-pr0') : null;

// ---------- Figure 1: database work per operation ----------
{
  const L = (r, k) => r.list[k];
  const rows = [];
  const listNames = [
    ['public-list-unbound', 'GET /v1/agents/sessions — 20 unbound Sessions'],
    ['public-list-bound', 'GET /v1/agents/sessions — 20 Workspace-bound'],
    ['webshell-list-unbound', 'WebShell sessions/query — 20 unbound'],
    ['webshell-list-bound', 'WebShell sessions/query — 20 Workspace-bound'],
    ['public-get', 'GET /v1/agents/sessions/{id}'],
    ['webshell-get', 'WebShell sessions/get'],
  ];
  for (const [k, label] of listNames) {
    const a = L(main, k), b = L(pr, k);
    rows.push([label, `${a.statementsPerCall} stmts · ${a.rowsExaminedPerCall} rows`, `${b.statementsPerCall} stmts · ${b.rowsExaminedPerCall} rows`, a.statementsPerCall === b.statementsPerCall ? 'same' : `✔ ${x(a.statementsPerCall, b.statementsPerCall)} fewer statements`]);
  }
  const hm = main.long.historyPhase, hp = pr.long.historyPhase;
  const lm = main.long, lp = pr.long;
  const snapRows = [
    [`Burst: 5 Turns × 3000 deltas (${hm.events.toLocaleString()} events)`, `${hm.snapshotUpdates} rewrites · ${mb(hm.snapshotBinlog.bytes)} binlog · ${hm.snapshotStatementMs} ms SQL`, `${hp.snapshotUpdates} rewrites · ${mb(hp.snapshotBinlog.bytes)} binlog · ${hp.snapshotStatementMs} ms SQL`, `✔ ${x(hm.snapshotUpdates, hp.snapshotUpdates)} fewer rewrites, ${x(hm.snapshotBinlog.bytes, hp.snapshotBinlog.bytes)} fewer bytes`],
    [`60 s stream: 1500 deltas @40 ms (${lm.newEvents.toLocaleString()} events, items_json ≈ ${Math.round(lm.itemsJsonBytesAfter / 1024)} KB)`, `${lm.snapshot.updates} rewrites · ${mb(lm.snapshot.binlog.bytes)} binlog · ${lm.snapshot.statementMs} ms SQL`, `${lp.snapshot.updates} rewrites · ${mb(lp.snapshot.binlog.bytes)} binlog · ${lp.snapshot.statementMs} ms SQL`, `✔ ${x(lm.snapshot.updates, lp.snapshot.updates)} fewer rewrites, ${x(lm.snapshot.binlog.bytes, lp.snapshot.binlog.bytes)} fewer bytes`],
    [`SSE read grants: 4 subscribers on that stream (2 public + 2 WebShell)`, `${lm.sse.workspaceAccessStatements.toLocaleString()} managed_workspace_access reads (${lm.sse.perSubscriberPerEvent}/subscriber/event)`, `${lp.sse.workspaceAccessStatements.toLocaleString()} reads (${lp.sse.perSubscriberPerEvent}/subscriber/event)`, `✔ ${x(lm.sse.workspaceAccessStatements, lp.sse.workspaceAccessStatements)} fewer; every subscriber still got ${lp.sse.delivered[0].events}/${lp.newEvents} events in order: ${lp.sse.delivered.every((d) => d.complete) ? 'yes' : 'NO'}`],
  ];
  const turnRow = [`Turn wall time (history Turns, host load 30–40)`, `${hm.turnMs.map((v) => (v / 1000).toFixed(1)).join(' / ')} s`, `${hp.turnMs.map((v) => (v / 1000).toFixed(1)).join(' / ')} s`, '~ no end-to-end change measurable on this host'];
  render('01-db-work', card({
    title: 'PR #13217 — database work per operation on the real stack',
    sub: STACK,
    blocks: [
      { h: 'Session list / detail (per call; average of 20 calls; idle-window background statements excluded)', table: table(['Operation', 'main', 'PR', 'Change'], rows) },
      { h: 'Snapshot materialization and SSE read grants (Workspace-bound Session, real Harness events)', table: table(['Workload', 'main', 'PR', 'Change'], [...snapRows, turnRow]) },
      { note: 'The three hot paths reachable through the public / WebShell APIs (list assembly, snapshot rewrites, SSE read grants) all shrink on a real MySQL 8.4.7 + Druid deployment; the list costs match the bounds in design §8 (3 / 4 / 3 / 6). Snapshot bytes are row-event bytes of managed_agent_snapshot in the binary log (ROW format, full images), i.e. what a replica also has to apply. Publication authorization (path 4) is not reachable this way — see the report.' },
    ],
  }));
}

// ---------- Figure 2: bounded staleness, measured ----------
function lagSvg(series, { w = 1480, h = 230, xMax, yMax, title }) {
  const padL = 56, padB = 30, padT = 22, padR = 16;
  const sx = (t) => padL + (t / xMax) * (w - padL - padR);
  const sy = (v) => h - padB - (v / yMax) * (h - padB - padT);
  let g = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" style="background:#0d1117">`;
  g += `<text x="${padL}" y="15" fill="#8b949e" font-size="13" font-family="Helvetica">${esc(title)}</text>`;
  for (let v = 0; v <= yMax; v += Math.max(1, Math.round(yMax / 4))) {
    g += `<line x1="${padL}" x2="${w - padR}" y1="${sy(v)}" y2="${sy(v)}" stroke="#21262d"/><text x="${padL - 8}" y="${sy(v) + 4}" fill="#8b949e" font-size="12" text-anchor="end" font-family="Menlo">${v}</text>`;
  }
  for (let t = 0; t <= xMax; t += 5000) g += `<text x="${sx(t)}" y="${h - 10}" fill="#8b949e" font-size="12" text-anchor="middle" font-family="Menlo">${t / 1000}s</text>`;
  for (const s of series) {
    const pts = s.points.map((p) => `${sx(p.t).toFixed(1)},${sy(Math.min(p.v, yMax)).toFixed(1)}`).join(' ');
    g += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2"/>`;
  }
  let lx = w - padR - 420;
  for (const s of series) { g += `<rect x="${lx}" y="6" width="14" height="4" fill="${s.color}"/><text x="${lx + 20}" y="13" fill="#e6edf3" font-size="13" font-family="Helvetica">${esc(s.label)}</text>`; lx += 210; }
  return g + '</svg>';
}
{
  const S = (run, f) => JSON.parse(readFileSync(`${RIG}/runs/${run}/${f}`, 'utf8'));
  const lm = S('ab-main', 'long-samples.json'), lp = S('ab-pr', 'long-samples.json');
  const pts = (s) => s.map((p) => ({ t: p.t, v: p.last - p.snapshot }));
  const xMax = Math.ceil(Math.max(lm.at(-1).t, lp.at(-1).t) / 5000) * 5000;
  const yMax = Math.max(10, ...pts(lp).map((p) => p.v), ...pts(lm).map((p) => p.v));
  const svg1 = lagSvg([{ label: 'main', color: '#f0883e', points: pts(lm) }, { label: 'PR', color: '#3fb950', points: pts(lp) }], { xMax, yMax, title: 'Events the snapshot (GET …/items) is behind managed_agent_session.last_sequence — 60 s stream, sampled every 250 ms' });
  const tm = S('ab-main', 'trickle-samples.json'), tp = S('ab-pr', 'trickle-samples.json');
  const xMax2 = Math.ceil(Math.max(tm.at(-1).t, tp.at(-1).t) / 5000) * 5000;
  const yMax2 = Math.max(5, ...tp.map((p) => p.last - p.snapshot), ...tm.map((p) => p.last - p.snapshot));
  const svg2 = lagSvg([{ label: 'main', color: '#f0883e', points: tm.map((p) => ({ t: p.t, v: p.last - p.snapshot })) }, { label: 'PR', color: '#3fb950', points: tp.map((p) => ({ t: p.t, v: p.last - p.snapshot })) }], { xMax: xMax2, yMax: yMax2, title: 'Trickle then pause: 40 deltas @250 ms, then the model holds the stream 12 s before finishing' });
  const rv = (r) => r.revoke.subscribers.map((s) => [s.label, s.closedAfterRevokeMs === null ? 'still open' : `${s.closedAfterRevokeMs} ms`, String(s.eventsAfterRevoke), s.endReason]);
  const revRows = [
    ...rv(main).map((r) => ['main', ...r]),
    ...rv(pr).map((r) => ['PR (default 5 s window)', ...r]),
    ...(pr0 ? rv(pr0).map((r) => ['PR + read-grant-recheck-interval=PT0S', ...r]) : []),
  ];
  const tr = (r) => r.trickle;
  render('02-staleness', card({
    title: 'PR #13217 — the two bounded-staleness relaxations, measured live',
    sub: 'Same stack as figure 1. Snapshot lag is read straight from MySQL (snapshot.covered_sequence vs session.last_sequence), which is exactly the covered_sequence GET /v1/agents/sessions/{id}/items reports.',
    blocks: [
      { svg: svg1 },
      { cap: `max lag: main ${main.long.lag.maxEventsBehind} events, PR ${pr.long.lag.maxEventsBehind} events · both converge at the terminal batch (lag 0 within ${main.long.materialized.ms} / ${pr.long.materialized.ms} ms of the Turn completing)` },
      { svg: svg2 },
      { cap: `paused stream: main lag ≤ ${tr(main).maxLagEvents} events for ≤ ${tr(main).longestSnapshotBehindMs} ms; PR lag ≤ ${tr(pr).maxLagEvents} events for up to ${tr(pr).longestSnapshotBehindMs} ms, deferral marker seen: ${tr(pr).maxStaleMarkerSeen} — WebShell transcript showed all ${tr(pr).finalTranscriptTokens} tokens throughout (it tails events past the snapshot)` },
      { h: 'Read-grant revocation on live SSE streams (can_read flipped to FALSE 4 s into a 15 s stream)', table: table(['Arm', 'Stream', 'Closed after revoke', 'Events delivered after revoke', 'End'], revRows) },
      { note: 'Both relaxations behave as documented: the snapshot trails by at most one 5 s refresh (or 1000 events) and converges at Turn end or ~5 s after ingestion pauses; a revoked reader is cut off within one 5 s window instead of at the next event, and PT0S restores the per-event cut-off. A new subscription after revocation is refused (404) in every arm.' },
    ],
  }));
}

// ---------- Figure 3: upgrade, rollback and rolling-window behaviour ----------
if (has('upg-4-pr') && has('mig-main')) {
  const u1 = R('upg-1-main'), u2 = R('upg-2-pr'), u3 = R('upg-3-main'), u4 = R('upg-4-pr');
  const mp = R('mig-pr'), mm = R('mig-main');
  const flyRows = (r) => r.springBoot.flyway.filter((l) => /Migrating schema|Successfully applied|Current version/.test(l)).map((l) => l.replace(/^.*DbMigrate\s+:\s*|^.*DbValidate\s+:\s*|^.*CommandLine\s+:\s*/, '').replace(/^.*\] [a-z.]+\s+: /, ''));
  const bodies = ['public-list-unbound', 'public-list-bound', 'webshell-list-unbound', 'webshell-list-bound', 'public-get', 'webshell-get'];
  const same = (a, b, k) => readFileSync(`${RIG}/runs/${a}/body-${k}.json`, 'utf8') === readFileSync(`${RIG}/runs/${b}/body-${k}.json`, 'utf8');
  const eqRows = bodies.map((k) => [k, same('upg-1-main', 'upg-2-pr', k) ? '✔ byte-identical' : '✖ differs', `${u1.list[k].statementsPerCall} → ${u2.list[k].statementsPerCall} stmts`]);
  const cont = (r) => r.continue.map((c) => c.status ?? '?');
  const contTxt = (r) => { const c = r.continue; const old = c.filter((x) => !x.fresh); return `${old.filter((x) => x.status === 'COMPLETED').length}/${old.length} old Sessions + ${c.filter((x) => x.fresh && x.status === 'COMPLETED').length}/1 new: COMPLETED`; };
  const tally = (h) => Object.entries(h?.listSessionStamps ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') || '—';
  const phaseRows = [
    ['1 main (V35): 41 Sessions, 29 with Turns', '—', 'n/a (V35 has no columns)'],
    ['2 PR boots on that DB → Flyway V36–V39', contTxt(u2), `before: ${tally(u2.journalHeadsBefore)} · after: ${tally(u2.journalHeadsAfter)}`],
    ['3 main again on the V39 schema (rollback / old fleet)', contTxt(u3), `after old-binary commits: ${tally(u3.journalHeadsAfterOld)}`],
    ['4 PR again', contTxt(u4), `before: ${tally(u4.journalHeadsBefore)} · after: ${tally(u4.journalHeadsAfterNew)}`],
  ];
  const ex = (r, k) => r.explain?.[k];
  const planRows = ['public-list-unbound', 'public-list-bound', 'webshell-list-unbound', 'webshell-list-bound'].map((k) => [k, `${ex(mm, k).statements} stmts · ${ex(mm, k).examined.toLocaleString()} rows · ${(ex(mm, k).dbUs / 1000).toFixed(1)} ms DB`, `${ex(mp, k).statements} stmts · ${ex(mp, k).examined.toLocaleString()} rows · ${(ex(mp, k).dbUs / 1000).toFixed(1)} ms DB`]);
  render('03-upgrade', card({
    title: 'PR #13217 — upgrade, rollback and the rolling-window stamp on one MySQL database',
    sub: 'Phases 1–4 run in order against one MySQL database (each phase = a fresh Spring + Harness process pair on the same deployment directories, as on a real host). Phase 3 is the old binary: Flyway reports “Successfully validated 39 migrations” and serves the V39 schema.',
    blocks: [
      { h: 'Flyway on the populated V35 database (phase 2)', pre: flyRows(u2).join('\n') },
      { h: 'Flyway on the ×100 scaled V35 database', pre: flyRows(mp).join('\n') },
      { h: 'Responses before and after the upgrade (same rows, phase 1 main vs phase 2 PR)', table: table(['Endpoint', 'Body', 'Statements per call'], eqRows) },
      { h: 'Mixed-binary phases', table: table(['Phase', 'New Turns', 'Journal-head activation stamp of the 28 list Sessions with journals'], phaseRows) },
      { note: 'Real Hosted Turns commit activation.changed, so PR commits fill the V36 head columns (ab-pr: 31/31 heads populated, stamp current). An old-binary commit advances journal_revision without touching them, and the stamp exposes it (6 lagging): the rolling-window skew the design relies on detecting. The next PR commit that carries an activation change re-stamps them (6 current). “null” = Sessions not committed to since the upgrade. The reader side (head path refusing a lagging or null head, rescan + backfill) is not reachable without tool publication; it is covered by the budget test on MySQL (figure 4). The first Turn after each restart waited 32–35 s for the previous Harness writer lease in every phase, both binaries alike.' },
    ],
  }));
}

// ---------- Figure 4: scaled database, online DDL, the PR's budget test on MySQL ----------
if (has('mig-main-x') && has('mig-pr-x')) {
  const mm = R('mig-main-x'), mp = R('mig-pr-x');
  const pages = ['public-list-unbound', 'public-list-bound', 'webshell-list-unbound', 'webshell-list-bound'];
  const rows = pages.map((k) => [k, `${mm.explain[k].statements} stmts · ${mm.explain[k].examined} rows · ${(mm.explain[k].dbUs / 1000).toFixed(1)} ms`, `${mp.explain[k].statements} stmts · ${mp.explain[k].examined} rows · ${(mp.explain[k].dbUs / 1000).toFixed(1)} ms`]);
  const plan = (k, re) => mp.explain[k].plans.find((p) => re.test(p.sql));
  const trim = (p) => (p?.plan ?? 'n/a').split('\n').map((l) => l.replace(/\(cost=[^)]*\)\s*/g, '').replace(/\s+$/, '')).filter(Boolean).slice(0, 14).map((l) => (l.length > 190 ? l.slice(0, 187) + '…' : l)).join('\n');
  const latest = plan('webshell-list-bound', /^SELECT turn_record\.session_id/);
  const env = plan('webshell-list-bound', /^SELECT event\.\* FROM managed_agent_event event JOIN \(SELECT session_id, MAX/);
  const ddl = existsSync(`${RIG}/out/ddl-online.txt`) ? readFileSync(`${RIG}/out/ddl-online.txt`, 'utf8').trim() : 'not run';
  const myt = existsSync(`${RIG}/out/mytest-summary.txt`) ? readFileSync(`${RIG}/out/mytest-summary.txt`, 'utf8').trim() : 'not run';
  render('04-scale-and-mysql', card({
    title: 'PR #13217 — on a ×100 database, and the PR’s own budget test on real MySQL',
    sub: 'Scaled database: the main-arm data copied ×100 (4,300 Sessions, 1,736,300 events, 2.1 GiB) into a V35 schema, then PR booted on it (Flyway V36–V39) and main booted on the result — so main’s per-row reads below also enjoy the V37 index, which favours main. One call per page; literal SQL from performance_schema / general_log; EXPLAIN ANALYZE on MySQL 8.4.7; server times on a host at load 30–40 are indicative only.',
    blocks: [
      { h: 'One 20-row page on the scaled database (statements · rows examined · server time)', table: table(['Page', 'main', 'PR'], rows) },
      { h: 'EXPLAIN ANALYZE — PR findLatestTurns (WebShell bound page)', pre: trim(latest) },
      { h: 'EXPLAIN ANALYZE — PR findLatestEnvironmentEvents (same page)', pre: trim(env) },
      { h: 'Observation — findLatestTurns cost grows with Turns per listed Session (20 Sessions; SHOW PROFILES median of 5, server time)', table: table(['Turns per Session', 'PR findLatestTurns (1 statement)', 'main per-row latest-turn read', 'main ×20'], [
        ['1', '0.61 ms', '0.10 ms', '≈ 2.1 ms + 20 round trips'],
        ['50', '1.16 ms', '0.15 ms', '≈ 3.1 ms + 20 round trips'],
        ['500', '4.49 ms', '0.30 ms', '≈ 6.0 ms + 20 round trips'],
        ['5,000', '35.95 ms', '0.20 ms', '≈ 4.0 ms + 20 round trips'],
      ]) },
      { cap: 'Plan: covering range scan over every turn.accepted entry of each listed Session, then MAX — no loose index scan. A per-Session ORDER BY … DESC LIMIT 1 rewrite was worse at 5,000 Turns (117 ms; 158 ms with FORCE INDEX: the dependent subquery sorts instead of diving), so this is a scaling note for very long-lived Sessions, not a proposed fix. Synthetic tenant: 20 Sessions × N Turns built by SQL on the scaled database.' },
      { h: 'V37 rebuilt on the scaled event table (2,136,300 rows) while a writer inserts an event every ~5 ms', pre: ddl },
      { h: 'Issue13181QueryBudgetTest — fixture switched from H2 to a fresh MySQL 8.4.7 schema per test (36-line patch), nothing else changed', pre: myt },
    ],
  }));
}
