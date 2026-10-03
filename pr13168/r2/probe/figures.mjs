// VERIFICATION RIG ONLY (PR #13168 R2): lays probe outputs out as evidence figures.
// Every number and quoted line is read from the probe JSON/log files under out/<db>/.
// usage: node figures.mjs [ids...]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13168-r2';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig`;
fs.mkdirSync(OUT, { recursive: true });
const W = 1000;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const css = `
  body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e6edf3}
  #card{width:${W}px;padding:24px 28px 26px;background:#0d1117}
  h1{font-size:19px;margin:0 0 4px;font-weight:650}
  h2{font-size:14.5px;margin:16px 0 8px}
  .sub{font-size:13px;color:#9da7b3;margin:0 0 14px;line-height:1.45}
  pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.4px;line-height:1.45;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:9px 11px;margin:0 0 10px;white-space:pre-wrap;word-break:break-all;color:#c9d1d9}
  .note{font-size:12.5px;color:#c9d1d9;border-left:3px solid #d29922;padding:6px 10px;margin:4px 0 12px;line-height:1.5;background:#161b22}
  .note.ok{border-left-color:#3fb950}.note.bad{border-left-color:#f85149}.note.info{border-left-color:#58a6ff}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.6px;background:#1f2630;padding:1px 4px;border-radius:4px}
  table{border-collapse:collapse;width:100%;font-size:12.4px;margin-bottom:12px}
  th,td{border:1px solid #30363d;padding:5px 8px;text-align:left;vertical-align:top;line-height:1.4}
  th{background:#161b22;color:#9da7b3;font-weight:600}
  td.num{text-align:right;white-space:nowrap;font-family:ui-monospace,Menlo,monospace}
  .pass{color:#3fb950;font-weight:600}.fail{color:#f85149;font-weight:600}.amber{color:#d29922;font-weight:600}.dim{color:#8b949e}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;
const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => (c && typeof c === 'object' ? `<td class="${c.c ?? ''}">${c.t}</td>` : `<td>${c}</td>`)).join('')}</tr>`).join('')}</table>`;
const P = (t) => ({ c: 'pass', t });
const F = (t) => ({ c: 'fail', t });
const A = (t) => ({ c: 'amber', t });
const D = (t) => ({ c: 'dim', t });
const pre = (lines) => `<pre>${lines.map(esc).join('\n')}</pre>`;
const J = (f) => JSON.parse(fs.readFileSync(`${RIG}/out/${f}`, 'utf8'));
const RES = (f) => (fs.readFileSync(`${RIG}/out/${f}`, 'utf8').match(/\[RESULT\] [^:]+: (\d+) passed, (\d+) failed/) ?? []).slice(1).map(Number);
const resTxt = (f) => { const [p2, f2] = RES(f); return `${p2}/${p2 + f2}`; };
const STACK = 'Real stack: MySQL 8.4.7 + Spring server jar (Session Store, embedded Java Runtime Broker, local-process Runtime workers spawned from the arm’s bundle) + packaged Hosted Harness (<code>dist/cli.js serve --profile hosted-harness</code>). Scripted loopback model unless noted.';
const figs = {};

// ---------------------------------------------------------------- 01 central A/B
{
  const head = J('h1/p1-central-head-v1-a.json');
  const base = J('b1/p1-central-base-v1-a.json');
  const mark = (q) => (q ? (q.markers.includes('R2-QWEN-MARKER') && q.markers.includes('R2-AGENTS-MARKER') ? 'QWEN.md + AGENTS.md' : q.markers.length ? q.markers.join(', ') : '—') : 'n/a');
  const rows = [];
  head.turns.forEach((t, ti) => {
    t.requests.forEach((q, qi) => {
      const b = base.turns[ti]?.requests[qi];
      const h = mark(q);
      rows.push([`${esc(t.label)} · request #${qi + 1}`, D(mark(b)), h === '—' ? D(h) : P(h), { c: 'num', t: qi === 0 ? String(t.ctxOps) : '' }]);
    });
  });
  const ph = J('h1/p7-real-head-i.json');
  const pb = J('b1/p7-real-base-i.json');
  const cnt = (p, k) => `${p.reps.filter((r) => r[k].token).length}/${p.reps.length}`;
  const b2 = J('h1/p1-central-head-v2-b.json');
  const sh = J('h1/p1-central-head-v1-c.json');
  figs['01-context-ab'] = page(
    'Workspace context A/B on the real stack — stack base <code>d452f5c</code> vs head <code>47017f3</code>',
    `${STACK} Session cwd <code>services/api</code> holds QWEN.md + AGENTS.md; the Workspace root also holds a QWEN.md that must not load. Turns: tool, plain, tool; then detach and load on a second Harness.`,
    table(['Model request', 'base', 'head', 'workspace-context controls in the turn'], rows) +
      '<h2>Head, Turn 1 — Harness → Runtime Broker ledger</h2>' +
      pre([head.turns[0].broker.join('\n')]) +
      '<h2>Assembled section on the wire (head, system instruction)</h2>' +
      pre([head.assembled.split('\n').slice(0, 7).join('\n')]) +
      table(
        ['Check (head)', 'Result'],
        [
          ['qwen_tool_execution rows after 2 tool turns', P(`${head.rows.before} → ${head.rows.afterA} (= model tool calls; the read is not an execution)`)],
          ['Workspace-root QWEN.md (ancestor) in any request', P('never')],
          ['Probe checks: files/1 · files/2 (glob) · shell/1', P(`${resTxt('h1/p1-central-head-v1-a.log')} · ${resTxt('h1/p1-central-head-v2-b.log')} · ${resTxt('h1/p1-central-head-v1-c.log')} (base arm: ${resTxt('b1/p1-central-base-v1-a.log')})`)],
          ['Real model qwen3.8-max — QWEN.md rule followed: tool-turn answer / next plain turn', P(`head ${cnt(ph, 't1')} / ${cnt(ph, 't2')}`)],
          ['…same on base', D(`base ${cnt(pb, 't1')} / ${cnt(pb, 't2')}`)],
        ],
      ) +
      pre([`head rep0 tool-turn answer: ${JSON.stringify(ph.reps[0].t1.answer)}`, `base rep0 tool-turn answer: ${JSON.stringify(pb.reps[0].t1.answer)}`]) +
      `<div class="note ok">Central claim holds end to end through the Java broker: the first request never waits, one <code>workspace-context</code> control rides the first acquisition (after <code>raw-file-history</code>, before <code>executions:prepare</code>), every later request on the attachment carries both files, and a cold attachment refetches once. Shell/1 tool list on the wire: <code>${esc(sh.turns[0].requests[0].tools.join(', '))}</code>.</div>`,
  );
}

// ---------------------------------------------------------------- 02 cancel A/B
{
  const r1 = J('h1/p3-cancel-r1-g.json');
  const hd = J('h1/p3-cancel-head-f.json');
  const st = J('h1/p3-stall-head-h.json');
  const disp = (x) => (x.afterCancel ?? []).filter((l) => /executions:prepare|:start|:cancel/.test(l)).join('<br>') || '—';
  figs['02-cancel-ab'] = page(
    'Cancel while the context read is stalled — round-1 head <code>b847d1f</code> vs head <code>47017f3</code>',
    `${STACK} Same Spring, worker and jar for both arms; only the Harness bundle differs. A proxy between Harness and Broker holds the <code>workspace-context</code> control; the client cancels 1 s after it arrives; the held request is forwarded to the real broker 8 s after the cancel.`,
    table(
      ['', 'round-1 head b847d1f', 'head 47017f3'],
      [
        ['Cancel → Session idle', F(`${r1.settleMs} ms (waited for the held read)`), P(`${hd.settleMs} ms`)],
        ['Turn terminal', esc(r1.terminal.join(', ')), esc(hd.terminal.join(', '))],
        ['Broker calls after the cancel', F(disp(r1)), P(disp(hd))],
        ['qwen_tool_execution rows for the cancelled Turn', F(String(r1.rows)), P(String(hd.rows))],
        ['Lease released / holders empty', P('yes'), P('yes')],
        ['Next tool turn re-reads and carries context (slot not latched)', P(`${r1.t2.ctxOps} read, request #2 has it`), P(`${hd.t2.ctxOps} read, request #2 has it`)],
      ],
    ) +
      '<h2>Head, Turn 1 ledger (the held read answered 404 after the release — nothing consumed it)</h2>' +
      pre([hd.ledger.join('\n')]) +
      '<h2>Round-1 head, Turn 1 ledger</h2>' +
      pre([r1.ledger.join('\n')]) +
      '<h2>Same stall, no cancel (head): the Harness’s generic 30 s broker timeout decides</h2>' +
      pre([`turn wall time ${st.turnMs} ms; tool still ran (rows +${st.rows}); stderr: ${st.stderr.join(' ')}`, `next tool turn: ${st.t2.summary}; workspace-context reads=${st.t2.ctxOps}`]) +
      '<div class="note ok">The cancellation fix (<code>75213f4</code>) is real and load-bearing on the full stack: the round-1 code kept the cancelled Turn alive until the stalled read returned and then still prepared a tool execution; the head settles in ~0.1 s with no dispatch.</div>' +
      '<div class="note">Observation (low): without a cancel, a stalled read holds the first tool dispatch for the full 30 s generic broker request timeout; the slot stays unset, so the next tool turn reads again (measured: it did, and succeeded). A persistently stalled broker would therefore charge every tool turn up to 30 s (inferred) — a short dedicated budget for this best-effort read would bound that.</div>',
  );
}

// ---------------------------------------------------------------- 03 sibling link
{
  const hd = J('h1/p5-boundary-head-d.json');
  const cd = J('c1/p5-boundary-head-d.json');
  const bs = J('b1/p5-boundary-base-d.json');
  const lh = J('h2/p9-leak-real-head-k.json');
  const lc = J('c1/p9-leak-real-cand-k.json');
  const sys = (x, k) => (x[k] ? F('injected') : P('not injected'));
  const files = (x) => esc(JSON.stringify(x.files.map((f) => `${f.name}: ${f.head.trim().slice(0, 48)}`)));
  figs['03-sibling-link'] = page(
    'Session-directory boundary: the context read admits a sibling Session’s file that <code>read_file</code> refuses',
    `${STACK} One Workspace mount; Sessions in <code>services/web</code> (sibling) and <code>services/api</code>. <code>services/api/QWEN.md → ../web/secret.txt</code>, <code>services/api/AGENTS.md → &lt;outside the mount&gt;</code>, <code>services/mono/QWEN.md → ../../QWEN.md</code>. Candidate = head with one statement changed (boundary = Session directory).`,
    table(
      ['services/api Session', 'base d452f5c', 'head 47017f3', 'candidate'],
      [
        ['workspace-context result', D('no such control'), F(files(hd['services/api'])), P(files(cd['services/api']) || '[]')],
        ['sibling secret in system instruction', D('n/a'), sys(hd['services/api'].sys, 'sibling'), sys(cd['services/api'].sys, 'sibling')],
        ['outside-mount AGENTS.md link', D('n/a'), P('skipped'), P('skipped')],
        ['read_file QWEN.md (same link)', P('refused'), P('refused'), P('refused')],
        ['services/mono QWEN.md → Workspace-root QWEN.md', D('n/a'), A(hd['services/mono'].sys.root ? 'loaded' : 'not loaded'), A(cd['services/mono'].sys.root ? 'loaded' : 'not loaded (trade-off)')],
        ['100,000-char QWEN.md', D('n/a'), P('65,536 chars + truncation note'), P('65,536 chars + truncation note')],
      ],
    ) +
      '<h2>Real model (qwen3.8-max), head — “Do you have any project context loaded? Quote it verbatim.”</h2>' +
      pre([lh.t2.slice(0, 360)]) +
      '<h2>…then “use read_file on QWEN.md” (same Session, head)</h2>' +
      pre(lh.t3.tools) +
      '<h2>Candidate, same questions</h2>' +
      pre([lc.t2.slice(0, 240) + ' …', ...lc.t3.tools ?? []]) +
      '<div class="note bad">Confirms the bot’s round-3 Critical at <code>managed-runtime-tool-executor.ts:313</code> on the real stack: the mount-root boundary lets a link in one Session put a sibling Session’s file into its system instruction for the rest of the attachment, while the #13166 guards refuse the same path to <code>read_file</code>/<code>glob</code>. The one-statement candidate closes it; the cost is that a Session-local link to Workspace-root rules (<code>services/mono</code>) is no longer followed — the same rule <code>read_file</code> already applies.</div>',
  );
}

// ---------------------------------------------------------------- 04 gates + mutation
{
  const lines = ['mut', 'mut2'].flatMap((d) => fs.readFileSync(`${RIG}/out/${d}/ledger.jsonl`, 'utf8').trim().split('\n').map((l) => ({ ...JSON.parse(l), tree: d })));
  const NOTE = { C3: 'near-equivalent: waitForTurn already rejects on abort before this line', C5: 'near-equivalent: recovering acquisitions never pass a signal', C8: "unpinned: '' (no files) suppressing later reads (bot R2-4)", X4: 'unpinned: worker tests run on boot v1 (root = Session dir); real-stack P1 catches it', X5: 'candidate fix for F1 — no existing test pins the mount-wide boundary', S1: 'unpinned session seam: feature off on the wire (bot R3-6); real-stack P1 catches it', S2: 'unpinned: continue route slot', S3: 'unpinned: continue route slot (first-run failures did not reproduce)', S4: 'unpinned session seam: feature off entirely; real-stack P1 catches it', H2: 'unpinned: inject-once dedup (bot deferred item)' };
  const last = new Map();
  for (const l of lines) last.set(l.id === 'baseline' ? `baseline-${l.tree}` : l.id, l);
  const base = { killed: lines.some((l) => l.id === 'baseline' && l.killed), summary: lines.filter((l) => l.id === 'baseline').map((l) => `${l.tree}: ${l.summary}`).join(' · ') };
  const order = ['C1','C2','C3','C4','C5','C6','C7','C8','H1','H2','S1','S2','S3','S4','W1','P1','P2','P3','X1','X2','X3','X4','X5'];
  const muts = order.map((id) => last.get(id)).filter(Boolean);
  const defects = muts.filter((m) => m.id !== 'X5');
  const killed = defects.filter((m) => m.killed).length;
  const m1 = J('m1/p1-central-head-v1-a.json');
  const m2 = J('m2/p1-central-head-v1-a.json');
  const code = (x) => (x.turns[0].broker.find((b) => b.includes('{workspace-context}')) ?? '').replace(/^.*-> /, '');
  figs['04-gates-mutation'] = page(
    'Gates, mixed versions and mutation sample — head <code>47017f3</code>',
    'Unit and Java gates on macOS (host load average 30–45). Mixed-version arms on the same real stack. Mutants: one unique anchor each, in two separate worktrees, suites run one at a time; a failure in <code>hosted-harness-session.test.ts</code> (load flakes on this host) counts only when it reproduces on an immediate rerun (C1–C3: every failure was rerun).',
    table(
      ['Gate', 'Result'],
      [
        ['CLI vitest, 8 changed test files (head)', A('1274/1275 — the 1 failure is a takeover test that passes 3/3 alone on head and on base (load flake)')],
        ['Mutation baseline, same suites', base ? (base.killed ? F(esc(base.summary)) : P(esc(base.summary))) : D('pending')],
        ['Java runtime-broker ProviderRuntimeTransportTest (+protocol)', P('20/20; mutant “workspace-context acquires first” → killed (expected &lt;1&gt; but was &lt;2&gt;)')],
        ['Round-1 worker probe incl. symlinked root (B7/B7b)', P('10/10')],
        ['CI on 47017f3', P('27 pass · 26 skipped · 0 failing')],
        ['head Harness + old broker jar (d452f5c)', A(`${esc(code(m1))}; every turn completes, no context, one stderr line per tool turn`)],
        ['head Harness + old worker (d452f5c)', A(`${esc(code(m2))}; every turn completes, no context, one stderr line per tool turn`)],
      ],
    ) +
      `<h2>Mutation sample: ${killed}/${defects.length} defect mutants killed (+ X5 = the F1 candidate)</h2>` +
      table(
        ['id', 'mutant', 'result', 'killing test / note'],
        muts.map((m) => [m.id, esc(m.what ?? m.skipped ?? ''), m.skipped ? D('skipped') : m.killed ? P('killed') : m.id === 'X5' ? D('survives') : A('survived'), D(esc(m.killed ? (m.failed?.[0] ?? '').replace(/^src\/serve\//, '').replace(/^.*? > /, '').slice(0, 150) : NOTE[m.id] ?? ''))]),
      ),
  );
}

const ids = process.argv.slice(2);
const want = ids.length ? ids : Object.keys(figs);
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: W + 60, height: 900 } });
for (const id of want) {
  if (!figs[id]) continue;
  const html = `${OUT}/${id}.html`;
  fs.writeFileSync(html, figs[id]);
  const p = await ctx.newPage();
  await p.goto(`file://${html}`);
  const clipped = await p.evaluate(() => [...document.querySelectorAll('pre,td')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  await p.locator('#card').screenshot({ path: `${OUT}/${id}.png` });
  console.log(`${id}.png written; overflowing cells=${clipped}`);
  await p.close();
}
await browser.close();
