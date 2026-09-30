// Build the evidence cards for PR 13109 from the RESULT lines of the rig runs,
// then screenshot each #card with Playwright. No number is typed by hand.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const S = path.resolve(import.meta.dirname, '..');
const load = (arm, name) => {
  const f = `${S}/runs/${arm}/${name}.log`;
  if (!existsSync(f)) throw new Error('missing ' + f);
  const line = readFileSync(f, 'utf8').split('\n').filter((l) => l.startsWith('RESULT ')).at(-1);
  if (!line) throw new Error('no RESULT in ' + f);
  return JSON.parse(line.replace(/^RESULT \S+ /, ''));
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// One ledger token -> readable, coloured HTML.
const ev = (t) => {
  let m;
  if ((m = /^S (.+)→(\d+)(?:!(.+))?$/.exec(t))) {
    const bad = m[2] !== '200';
    return `<span class="s">store commit</span> ${esc(m[1].replace(/:/g, ' = '))} ${bad ? `<span class="bad">${m[2]}${m[3] ? ' (rig fault)' : ''}</span>` : m[3] ? `<span class="warn">committed, reply dropped (rig fault)</span>` : ''}`;
  }
  if ((m = /^B (\S+?):(\d+)(?:!(\S+))?(?: (.*))?$/.exec(t))) {
    const [, name, status, fault, extra] = m;
    const bad = Number(status) >= 400 || status === '0';
    const label = name.replace('owner-acquire', 'Broker acquire owner').replace('owner-release', 'Broker release owner');
    let tail = '';
    if (fault && status === '200') tail = ` <span class="warn">done, reply dropped (rig fault)</span>`;
    else if (fault) tail = ` <span class="warn">rig fault, not forwarded</span>`;
    const st = extra ? ` ${esc(extra)}` : '';
    return `<span class="b">${esc(label)}</span> <span class="${bad ? 'bad' : 'ok'}">${status === '0' ? 'connection reset' : status}</span>${/unknown|409|conflict|not_/.test(st) ? `<span class="bad">${st}</span>` : `<span class="dim">${st}</span>`}${tail}`;
  }
  return esc(t);
};
const compress = (tl) => {
  // collapse runs of identical "mcp-status running" polls
  const out = [];
  for (const t of tl) {
    const last = out.at(-1);
    if (last && last.t === t) last.n++;
    else out.push({ t, n: 1 });
  }
  return out.map((x) => ev(x.t) + (x.n > 1 ? ` <span class="dim">×${x.n}</span>` : ''));
};
const st = (s) => `<span class="${String(s).startsWith('204') ? 'ok' : 'bad'} big">${esc(String(s).replace(':managed_session_close_failed', ''))}</span>`;
const attempt = (title, d, facts) => `<div class="att"><div class="ah">${title} → ${st(d.status)} <span class="dim">${esc(facts)}</span></div>${compress(d.timeline ?? []).map((l) => `<div class="e">${l}</div>`).join('') || '<div class="e dim">(no Broker request, no store commit)</div>'}</div>`;
const page = (title, sub, body, note) => `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#0d1117;color:#e6edf3;font:15px/1.5 -apple-system,Helvetica,Arial,sans-serif}
#card{width:1560px;padding:26px 30px 24px;background:#0d1117}
h1{font-size:23px;margin:0 0 4px}.sub{color:#8b949e;margin:0 0 16px;font-size:14.5px}
.cols{display:flex;gap:14px}.col{flex:1;border:1px solid #30363d;border-radius:8px;padding:12px 14px;background:#161b22;min-width:0}
.col h2{font-size:16px;margin:0 0 8px}.att{margin:0 0 10px}.ah{font-weight:600;margin-bottom:2px}
.e{font:13px/1.55 ui-monospace,Menlo,monospace;padding-left:16px;white-space:nowrap}
.ok{color:#3fb950}.bad{color:#ff7b72}.warn{color:#d29922}.dim{color:#8b949e}.b{color:#79c0ff}.s{color:#d2a8ff}.big{font-size:16px}
table{border-collapse:collapse;width:100%;margin-top:6px;font-size:14px}th,td{border:1px solid #30363d;padding:5px 9px;text-align:left;vertical-align:top}
th{background:#161b22;color:#8b949e;font-weight:600}td.m{font:13px/1.5 ui-monospace,Menlo,monospace}
.note{border-left:3px solid #1f6feb;padding:6px 12px;margin-top:14px;color:#c9d1d9;font-size:14.5px}
h3{font-size:16px;margin:18px 0 4px}
</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}${note ? `<div class="note">${note}</div>` : ''}</div>`;

const facts1 = (d) => `holder ${d.holder} · Broker ${String(d.runtime).split(':').pop()} · record ${String(d.records).replace(/@rev\d+/g, '')}`;
const colR1 = (label, r) => `<div class="col"><h2>${label}</h2>${r.detach.map((d) => attempt(`detach #${d.n}`, d, facts1(d))).join('')}<div class="ah">Workspace holder at the end: <span class="${r.lease === 'free' ? 'ok' : 'bad'}">${r.lease}</span> · release operation IDs used: ${new Set(r.detach.flatMap((d) => d.releaseOps)).size} · owners: ${r.owners}</div></div>`;

// ---- card 1: undelivered release, one server + matrix ----
const b1 = load('base', 'r1b-undelivered-1');
const h1 = load('head', 'r1b-undelivered-1');
const row = (label, name, pick = (r) => r.final) => {
  const cell = (arm) => {
    try {
      const r = load(arm, name);
      const seq = (r.detach ?? r.tries).map((d) => String(d.status).replace(':managed_session_close_failed', '')).join(' → ');
      return `<td class="m"><span class="${String(pick(r)).startsWith('204') ? 'ok' : 'bad'}">${esc(seq)}</span> <span class="dim">holder ${r.lease}</span></td>`;
    } catch {
      return '<td class="m dim">not run</td>';
    }
  };
  return `<tr><td>${label}</td>${cell('base')}${cell('head')}</tr>`;
};
const matrix = `<h3>Detach status per attempt, same fault on both builds</h3><table><tr><th>Fault injected on the release path</th><th>base 7827a3ff</th><th>PR cb322eed</th></tr>
${row('first <code>mcp-release</code> not delivered, 1 server (Streamable HTTP)', 'r1-undelivered-1')}
${row('first <code>mcp-release</code> not delivered, 1 server (stdio)', 'r1-undelivered-stdio')}
${row('first <code>mcp-release</code> not delivered, 2 servers', 'r1-undelivered-2')}
${row('<code>mcp-release</code> done, reply lost', 'r1-lostreply-1')}
${row('owner release done, acknowledgement lost, 1 server', 'r1-lostack-1')}
${row('owner release done, acknowledgement lost, 2 servers', 'r1-lostack-2')}
${row('no fault, 3 servers (HTTP + SSE + stdio)', 'r1-none-3')}
</table>`;
const card1 = page(
  'PR #13109 · first mcp-release never reaches the Runtime · one pinned server',
  'Real Spring Broker + Runtime worker + packaged Harness on MySQL 8.4.11. The Broker proxy answers the first mcp-release with 503 without forwarding it. B = Broker request, store commit = MCP configuration record written by the Harness.',
  `<div class="cols">${colR1('base 7827a3ff (main before this PR)', b1)}${colR1('PR head cb322eed', h1)}</div>${matrix}`,
  'On base the second detach asks the Broker to release the owner first; the connection is still open, so the Broker refuses (409) and moves the runtime Session to RELEASING, after which every acquire is refused and the original release can never be re-sent. On the PR the owner is still READY, the retry re-acquires it, re-sends the release with the same operation ID, commits the drain receipt and only then releases the owner.',
);

// ---- card 2: sticky stdout ----
const colR2 = (label, r) => `<div class="col"><h2>${label}</h2><table><tr><th>detach at</th><th>status</th><th>stdout holder</th><th>release receipt of <code>sticky</code></th><th>durable records</th><th>holder</th></tr>${r.tries
  .map((d) => {
    const tl = d.timeline ?? [];
    const rel = [...tl].reverse().find((t) => /mcp-(status|release):200 (settled|outcome_unknown)/.test(t) && !/S /.test(t));
    const state = tl.some((t) => /sticky:drained/.test(t)) ? 'settled' : rel ? (rel.includes('outcome_unknown') ? 'outcome_unknown (managed_mcp_drain_unknown)' : 'settled') : '—';
    return `<tr><td class="m">${esc(String(d.at).split('→')[0])}</td><td class="m">${st(d.status)}</td><td class="m">${d.pipeHolderAlive ? '<span class="warn">alive</span>' : '<span class="ok">exited</span>'}</td><td class="m"><span class="${state === 'settled' ? 'ok' : 'bad'}">${state}</span></td><td class="m">${esc(String(d.records).replace(/@rev\d+/g, '').replace(/,/g, ', '))}</td><td class="m"><span class="${d.holder === 'free' ? 'ok' : 'bad'}">${d.holder}</span></td></tr>`;
  })
  .join('')}</table><div class="ah" style="margin-top:8px">stdout pipe closed at ${r.pipeClosedAt} s · final ${st(r.final)} · Workspace holder <span class="${r.lease === 'free' ? 'ok' : 'bad'}">${r.lease}</span></div></div>`;
const b2 = load('base', 'r2b-sticky-remote');
const h2 = load('head', 'r2b-sticky-remote');
const last = h2.tries.at(-1);
const card2 = page(
  'PR #13109 · release exceeds the 5 s drain bound · two pinned servers (sticky stdio + Streamable HTTP)',
  'The stdio server exits on release, but a grandchild (<code>sleep 45</code>) inherited its stdout, so the transport only closes when that process exits. Detach is retried every 8 s; times are seconds since the grandchild started.',
  `<div class="cols">${colR2('base 7827a3ff', b2)}${colR2('PR head cb322eed', h2)}</div><h3>PR head, the detach after the pipe closed (${esc(last.at)})</h3><div class="col">${compress(last.timeline).map((l) => `<div class="e">${l}</div>`).join('')}</div>`,
  'While the pipe is held both builds keep the Workspace holder and answer 503. After the pipe closes, base still replays the stored <code>outcome_unknown</code> for the same release operation and never reaches the second server. On the PR the original release receipt becomes <code>settled</code> once the transport has physically closed, so the drain receipt is committed, the second server is released and the owner is released last.',
);

// ---- card 3: old writer, never dispatched, skew ----
const r3a = load('head', 'r3-lostack');
const r3b = load('head', 'r3-undelivered1');
const r3c = load('head', 'r3-fenced');
const r4a = load('head', 'r4b-503');
const r4b = load('head', 'r4b-drop');
const r5 = load('skew2', 'r5-skew-split');
const tlrow = (what, status, tl, extra) => `<tr><td>${what}</td><td class="m">${st(status)}</td><td class="m">${compress(tl).join('<br>') || '<span class="dim">(no Broker request, no store commit)</span>'}</td><td class="m">${extra}</td></tr>`;
const nw = (r) => r.newWriter.at(-1);
const card3 = page(
  'PR #13109 · records left by an older writer, a configuration that never dispatched, and store/Harness version skew',
  'Same real stack, MySQL 8.4.11. "Old writer" = the base Harness CLI (7827a3ff) really writing the records; it is then stopped, its 60 s writer lease expires, and the PR Harness loads the Session. SQL history is never edited.',
  `<table><tr><th style="width:26%">Situation</th><th style="width:7%">detach by the PR Harness</th><th>Broker requests and record commits of that detach</th><th style="width:17%">after</th></tr>
${tlrow('Old writer: owner release succeeded, acknowledgement lost (records <code>releasing</code>, Broker RELEASED)', nw(r3a).status, nw(r3a).timeline, `holder ${nw(r3a).holder}<br>MCP controls re-sent: ${nw(r3a).mcpControls.length}`)}
${tlrow('Old writer: first <code>mcp-release</code> undelivered, one detach (Broker still READY)', nw(r3b).status, nw(r3b).timeline, `holder ${nw(r3b).holder}`)}
${tlrow('Old writer: undelivered release and a second detach (old fast path fenced the owner while the connection is open)', nw(r3c).status, nw(r3c).timeline, `holder <span class="bad">${nw(r3c).holder}</span>, Broker RELEASING<br><span class="dim">documented as out of scope</span>`)}
${tlrow('Never-dispatched configuration, <code>drained</code> commit refused by the store path (503), Session reloaded by a new Harness', r4a.B_detach.at(-1).status, r4a.B_detach.at(-1).timeline, `acquire requests: ${r4a.B_detach.at(-1).acquires}<br>holder still Session A: ${r4a.B_detach.at(-1).holderStillA}`)}
${tlrow('Never-dispatched configuration, <code>drained</code> committed but reply lost, Session reloaded by a new Harness', r4b.B_detach.at(-1).status, r4b.B_detach.at(-1).timeline, `acquire requests: ${r4b.B_detach.at(-1).acquires}<br>holder still Session A: ${r4b.B_detach.at(-1).holderStillA}`)}
${tlrow('Skew: PR Harness writes <code>drained</code> to a <b>base</b> store', r5.oldStore[0].status, r5.oldStore[0].timeline, `holder <span class="bad">${r5.oldStore[0].holder}</span><br>store: 409 Invalid MCP releaseState`)}
${tlrow('Skew: store upgraded to the PR build, same Harness process retries', r5.newStoreSameHarness.at(-1).status, r5.newStoreSameHarness.at(-1).timeline, `holder <span class="bad">${r5.newStoreSameHarness.at(-1).holder}</span><br><span class="dim">writes of this Session stopped after the refused commit</span>`)}
${tlrow('Skew: store upgraded, Session loaded by a new Harness', r5.newStoreNewHarness.at(-1).status, r5.newStoreNewHarness.at(-1).timeline, `holder ${r5.newStoreNewHarness.at(-1).holder}`)}
</table>`,
  'A RELEASED owner answers acquire with 409 <code>runtime_session_not_acquirable</code>; an owner fenced while its connection is still open answers 409 <code>runtime_session_not_ready</code> and then refuses the release itself (409), so that Session stays held, as the design text says. The skew row is the consequence of deploying the Harness before the store: detach fails closed and recovers after the store is upgraded and the Session is reloaded.',
);

// ---- card 4: Broker replaced between the drain receipt and the owner release (Linux) ----
const lxB = load('lx-base', 'r8-releasing-restart');
const lxH = load('lx-head-r8', 'r8-drained-restart');
const lxC = load('lx-cand', 'r8-drained-restart');
const facts4 = (d) => `holder ${d.holder} · Broker row ${String(d.runtime).split(':').pop()} · record ${String(d.records).replace(/@rev\d+/g, '')}`;
const colR8 = (label, r) => {
  const w = r.brokerRestart;
  const same = w.workersBefore.map((x) => x.split(':')[0]).every((pid) => w.workersAfter.some((y) => y.split(':')[0] === pid));
  const afters = r.afterRestart;
  const shown = afters.length > 3 ? [afters[0], afters.at(-1)] : afters;
  return `<div class="col"><h2>${label}</h2>${attempt('detach before the restart', r.beforeRestart[0], facts4(r.beforeRestart[0]))}<div class="ah warn" style="margin:6px 0 10px">Broker JVM killed (SIGKILL) and started again in ${w.seconds} s · worker process ${same ? 'survived (same PID)' : 'changed'}</div>${shown.map((d) => attempt(esc(d.n.replace('after restart ', 'detach ')), d, facts4(d))).join('')}${afters.length > 3 ? `<div class="ah dim">${afters.length} detach attempts after the restart in total (3 by the same Harness, ${afters.length - 3} after a new Harness loaded the Session): all ${esc(String(afters[1].status).split(':')[0])}</div>` : ''}<div class="ah" style="margin-top:6px">Workspace holder at the end: <span class="${r.lease === 'free' ? 'ok' : 'bad'}">${r.lease}</span></div></div>`;
};
const card4 = page(
  'PR #13109 · review thread R1-1 · the Broker is replaced after the drain receipt, before the owner release',
  'Linux container (Ubuntu 24.04, kernel 6.8, JDK 21), MySQL 8.4.11, durable local workers, so a restarted Broker can adopt the surviving Runtime worker. Detach #1: the owner release is answered 503 by the rig proxy and never reaches the Broker. Then the Broker JVM is killed and restarted.',
  `<div class="cols">${colR8('base 7827a3ff', lxB)}${colR8('PR head cb322eed', lxH)}${colR8('PR head + suggested retry (+12 lines)', lxC)}</div>`,
  'A restarted Broker has the runtime Session row READY but not in memory, and answers the release with 503 <code>runtime_reconciliation_required</code>. Base then looks the release up, which acquires the owner (the Broker adopts the Session), and the release succeeds. On the PR every record is already <code>drained</code>, so close() goes straight to the owner release and never acquires: detach stays 503 and the Workspace stays held, also after a new Harness loads the Session. With the retry suggested in the review thread (acquire once when the release is refused with that code) the same sequence ends 204.',
);

const out = { '01-undelivered-release-ab.html': card1, '02-drain-timeout-ab.html': card2, '03-old-writer-never-dispatched-skew.html': card3, '04-broker-replaced-after-drain-receipt.html': card4 };
for (const [name, html] of Object.entries(out)) writeFileSync(`${S}/fig/${name}`, html);
const require = createRequire(`${S}/wt-head/package.json`);
const { chromium } = require('playwright');
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1640, height: 1200 } });
for (const name of Object.keys(out)) {
  const p = await ctx.newPage();
  await p.goto(`file://${S}/fig/${name}`);
  const clipped = await p.evaluate(() => [...document.querySelectorAll('.e, td.m, .col')].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent.slice(0, 80)));
  await p.locator('#card').screenshot({ path: `${S}/fig/${name.replace('.html', '.png')}` });
  console.log(name, 'clipped:', clipped.length, clipped.slice(0, 3));
}
await browser.close();
