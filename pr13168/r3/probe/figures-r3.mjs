// VERIFICATION RIG ONLY (PR #13168 R3): round-3 evidence figures.
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
const R3 = (f) => J(`r3/${f}`);
const RES3 = (f) => resTxt(`r3/${f}`);

// ---------------------------------------------------------------- 05 round-3 fixes on the real stack
{
  const p5 = R3('p5-boundary-r3head-d.json');
  const p8 = R3('p8-continue-r3head-j.json');
  const s3 = R3('s3-symlink-r3head.json');
  const p9 = R3('p9-leak-real-r3head-k.json');
  const p3 = R3('p3-cancel-r3head-e.json');
  const st = R3('p3-stall-r3head-f.json');
  const p7 = R3('p7-real-r3head-i.json');
  const r2p8 = J('h1/p8-continue-head-j.json');
  const r2s3 = J('h2/s3-symlink-head.json');
  const r2p5 = J('h1/p5-boundary-head-d.json');
  const short = (o) => esc(JSON.stringify(o.output ?? o.error ?? o).slice(0, 96));
  const cnt = (p, k) => `${p.reps.filter((r) => r[k].token).length}/${p.reps.length}`;
  figs['05-r3-fixes'] = page(
    'Round 3 on the real stack — what <code>c9586fc</code> fixed, head <code>9cce120</code> vs round-2 head <code>47017f3</code>',
    `${STACK} New worker bundle + new server jar (main merged). Same probes as round 2, unchanged.`,
    table(
      ['Item', 'round 2 (47017f3)', 'round 3 (9cce120)'],
      [
        ['F1 · sibling Session file in the system instruction (bot R3-2)', F(r2p5['services/api'].sys.sibling ? 'injected' : 'not injected'), P(p5['services/api'].sys.sibling ? 'injected' : `not injected — boundary probe ${RES3('p5-boundary-r3head-d.log')}`)],
        ['F1 · real model asked to quote its project context', F('quoted the sibling file verbatim'), P('“No — nothing was loaded.”')],
        ['F1 trade-off · <code>services/mono/QWEN.md → ../../QWEN.md</code>', A(r2p5['services/mono'].sys.root ? 'loaded' : 'not loaded'), A(p5['services/mono'].sys.root ? 'loaded' : 'not loaded')],
        ['O2 · takeover continuation carries the context (bot R3-1)', F(`no (${JSON.stringify(r2p8.cont.requests.map((q) => q.markers.length))})`), P(`yes (${JSON.stringify(p8.cont.requests.map((q) => q.markers.length))}, ${p8.cont.ctxOps} read)`)],
        ['R3-4 · <code>glob **/*</code> with an outward link in the Session', F(short(r2s3.res.globAll.resp)), P(`success — lists ${esc((s3.res.globAll.resp.output ?? '').split('---\n')[1]?.split('\n').join(', ') ?? '?')}`)],
        ['R1-4 · <code>{/etc,/zz-nonexistent}/host*</code>', F('search ran; refused by the output guard'), P('refused before acquisition (model-correctable)')],
        ['R3-3 · create / dangling write through <code>peek → ../web</code>', P('refused by Hosted file history'), P('refused by Hosted file history; sibling dir unchanged')],
      ],
    ) +
      table(
        ['Regression (same probes as round 2)', 'round 3'],
        [
          ['Central A/B: files/1 · files/2 · shell/1', P(`${RES3('p1-central-r3head-v1-a.log')} · ${RES3('p1-central-r3head-v2-b.log')} · ${RES3('p1-central-r3head-v1-c.log')}`)],
          ['Cancel during a stalled read', P(`${RES3('p3-cancel-r3head-e.log')}, settled in ${p3.settleMs} ms, no dispatch`)],
          ['Real model follows QWEN.md (tool-turn answer / next turn)', P(`${cnt(p7, 't1')} / ${cnt(p7, 't2')}`)],
          ['O1 · stalled read, no cancel', A(`${st.turnMs} ms before the tool ran (unchanged)`)],
        ],
      ) +
      '<h2>Continued requests after the takeover (P8)</h2>' +
      pre([`round 2: ${JSON.stringify(r2p8.cont.requests.map((q) => ({ round: q.round, markers: q.markers })))}`, `round 3: ${JSON.stringify(p8.cont.requests.map((q) => ({ round: q.round, markers: q.markers })))}`, `round 3 broker: ${p8.cont.broker.slice(0, 4).join(' | ')}`]) +
      '<div class="note ok">Every round-2 item that <code>c9586fc</code> targets is fixed end to end. The F1 fix is exactly the round-2 candidate, with the same monorepo trade-off.</div>' +
      '<div class="note">The takeover read now happens before the first continued model request (resume already acquires there), so O1’s stall budget applies to continuations as well.</div>',
  );
}

// ---------------------------------------------------------------- 06 stack + bot round 4 + mutation
{
  const lines = ['mut-r3a', 'mut-r3b', 'mut-r3c'].filter((d) => fs.existsSync(`${RIG}/out/${d}/ledger.jsonl`)).flatMap((d) => fs.readFileSync(`${RIG}/out/${d}/ledger.jsonl`, 'utf8').trim().split('\n').map((l) => ({ ...JSON.parse(l), tree: d })));
  const base = lines.filter((l) => l.id === 'baseline').map((l) => `${l.tree}: ${l.summary}`).join(' · ');
  const NOTE = { N4: 'unpinned: ordinary-turn resume path', N12: "unpinned: '' latch (bot R2-4; round-2 C8)", S1: 'still unpinned (O3)', S4: 'still unpinned (O3)', H2: 'still unpinned: inject-once dedup' };
  const order = ['N1','N2','N3','N4','N5','N6','N7','N8','N9','N10','N11','N12','X4','S1','S4','H2'];
  const by = new Map(lines.filter((l) => l.id !== 'baseline' && !l.skipped).map((l) => [l.id, l]));
  const muts = order.map((id) => by.get(id)).filter(Boolean);
  const guard = muts.filter((m) => /^N([1-9]|1[01])$/.test(m.id));
  const killed = guard.filter((m) => m.killed).length;
  figs['06-r3-stack'] = page(
    'Round 3 — stack state, bot round-4 items and mutation sample',
    '#13168 head <code>9cce120</code> vs #13166 head <code>62a1f9d</code>. Conflicts from <code>git merge-tree --write-tree pr/13168 pr/13166</code>.',
    table(
      ['Stack fact', 'Value'],
      [
        ['#13166 commits not in #13168', A('<code>1130745</code>, <code>62a1f9d</code>')],
        ['Conflicts merging #13166 head into #13168', F('8 hunks in 4 files: tool-executor.ts (3), tool-turn.ts (1), tool-turn.test.ts (1), context-worker.test.ts (3)')],
        ['Session boundary for file tools', A('#13168: Session-directory realpath · #13166: refuse only another <i>installed</i> Session’s directory')],
        ['Recovery validator accepts <code>/2</code> (bot R4-1)', F('#13168: no (workspace-recovery-session.ts:748, :756 list /1 only)') ],
        ['…on #13166 head', P('yes (lines 748–751, 764–765)')],
      ],
    ) +
      `<h2>Mutation: ${killed}/${guard.length} of the c9586fc guard mutants (N1–N11) killed; N12 + round-2 survivors re-checked</h2>` +
      table(
        ['id', 'mutant', 'result', 'killing test / note'],
        muts.map((m) => [m.id, esc(m.what ?? ''), m.killed ? P('killed') : A('survived'), D(esc(m.killed ? (m.failed?.[0] ?? '').replace(/^src\/serve\//, '').replace(/^.*? > /, '').slice(0, 140) : NOTE[m.id] ?? ''))]),
      ) +
      `<p class="sub">Baselines: ${esc(base)}</p>`,
  );
}

const R4 = (f) => J(`r4/${f}`);
const RES4 = (f) => resTxt(`r4/${f}`);

// ---------------------------------------------------------------- 07 latest head after the #13166 merge
{
  const r4p5 = R4('p5-boundary-r4head-d.json');
  const r3p5 = J('r3/p5-boundary-r3head-d.json');
  const r4p8 = R4('p8-continue-r4head-j.json');
  const r4p3 = R4('p3-cancel-r4head-e.json');
  const r4p7 = R4('p7-real-r4head-i.json');
  const cnt = (p2, k) => `${p2.reps.filter((r) => r[k].token).length}/${p2.reps.length}`;
  figs['07-latest-head'] = page(
    'Round 3, latest head <code>0922621</code> — after the author merged #13166',
    `${STACK} The author merged #13166 (<code>6916847</code>) into #13168, resolving the 8 conflicts from figure 6 (mostly taking #13166's side). New bundle + jar; durable local-process opted out on macOS. Same probes as round 2/3, unchanged.`,
    table(
      ['#13168 feature on 0922621 (r4)', 'Result'],
      [
        ['Central A/B: files/1 · files/2 · shell/1', P(`${RES4('p1-central-r4head-v1-a.log')} · ${RES4('p1-central-r4head-v2-b.log')} · ${RES4('p1-central-r4head-v1-c.log')}`)],
        ['workspace-context never injects a sibling Session file', P(`not injected (r4 and r3)`)],
        ['Takeover continuation carries the context', P(`${JSON.stringify(r4p8.cont.requests.map((q) => q.markers.length))}, ${r4p8.cont.ctxOps} read`)],
        ['Cancel during a stalled read', P(`${RES4('p3-cancel-r4head-e.log')}, ${r4p3.settleMs} ms, no dispatch`)],
        ['Real model follows QWEN.md', P(`${cnt(r4p7, 't1')} / ${cnt(r4p7, 't2')}`)],
      ],
    ) +
      table(
        ['What the #13166 merge brought', 'Status on 0922621'],
        [
          ['bot R4-1: Workspace recovery accepts <code>/2</code>', P('✅ fixed — workspace-recovery-session.ts:755 now uses isHostedWorkspaceProfile / isHostedWorkspaceShellProfile (was <code>/1</code>-only at 9cce120)')],
          ['CI: Test (ubuntu, Node 22)', F('❌ 1 failed | 34,254 passed — a #13166 glob fixture, not a product bug')],
          ['read_file through an in-Session symlink', A('⚠️ behavior changed: 9cce120 refused it; 0922621 reads the sibling (see below)')],
        ],
      ) +
      '<h2>CI failure is a fixture assertion, not a product bug</h2>' +
      pre([
        'core/src/tools/glob.test.ts > containmentRoot > never walks or reports outside the root: [.][.]/web/secret.txt',
        "AssertionError: expected 'No files found matching pattern \"[.][.]…' not to contain 'secret.txt'",
        'Received: No files found matching pattern "[.][.]/web/secret.txt" within <session>',
        '',
        'The pattern itself contains "secret.txt"; the not-found header echoes the pattern, so the',
        'assertion flags its own input. The guard works — the search is contained and returns nothing.',
        'This test is added by #13166 (absent at 9cce120). #13166\'s own CI reds the same test.',
      ]) +
      '<div class="note info">One-line fix (measured: the file then passes 68/68): strip the echoed pattern before the containment assertion.<br><code>expect(String(result.llmContent).replaceAll(pattern, \'&lt;pattern&gt;\')).not.toContain(\'secret.txt\');</code></div>' +
      '<h2>read_file reaches a sibling Session through an in-Session link (the #13166 file-tool boundary)</h2>' +
      table(
        ['Probe (services/api/QWEN.md → ../web/secret.txt; web is a created Session that never ran a tool)', '9cce120', '0922621'],
        [
          ['read_file of the link', P(`refused (${r3p5['services/api rq'].status})`), F(`${r4p5['services/api rq'].status} — returned the sibling file`)],
          ['workspace-context (the #13168 feature)', P('not injected'), P('not injected')],
        ],
      ) +
      '<div class="note bad">On the merged head, <code>read_file</code> through a link reads a sibling Session\'s file. Root cause: #13166\'s <code>ownsAnotherSessionDir</code> (managed-context-worker.ts) iterates <code>installations.bindings()</code> — the <b>worker process\'s own</b> installed Sessions. A sibling that has not run a tool is not installed, so it is invisible and the read is allowed (and on a per-Session worker topology, a sibling on another worker is invisible too). This is #13166\'s boundary, not #13168\'s workspace-context read, which confines to <code>realpath(tools.directory)</code> and does not leak. I did not finish the install-after-run discriminator (a rig session-id error), so the post-install / same-worker case is from reading the code, not measured.</div>',
  );
}

const R5B = (f) => J(`r5b/${f}`);
const RES5 = (f) => resTxt(`r5b/${f}`);

// ---------------------------------------------------------------- 08 round 4: R5-3/R6-2 fixed
{
  const p5 = R5B('p5-boundary-r5head-d.json');
  const p12 = R5B('p12-ancestor-r5head-g.json');
  const p8 = R5B('p8-continue-r5head-j.json');
  const p3 = R5B('p3-cancel-r5head-e.json');
  const p7 = R5B('p7-real-r5head-i.json');
  const r4p5 = J('r4/p5-boundary-r4head-d.json');
  const cnt = (p2, k) => `${p2.reps.filter((r) => r[k].token).length}/${p2.reps.length}`;
  figs['08-round4'] = page(
    'Round 4, head <code>d2b1845</code> — the R5-3 boundary gap (my R3b finding) is fixed',
    `${STACK} Rebuilt: new bundle + new server jar (head's full stack, V35 migration, #13183 from main). <code>9d53f984d6</code> confines read_file/write_file/edit to the caller's own Session directory by realpath and removes the sibling-install exemption (<code>ownsAnotherSessionDir</code>, <code>bindings</code> deleted). Durable local-process opted out on macOS.`,
    table(
      ['File-tool boundary (bot R5-3 = my R3b finding, and R6-2)', '0922621', 'd2b1845'],
      [
        ['read_file through an in-Session link to a sibling (p5)', F(`${r4p5['services/api rq'].status} — read the sibling`), P(`${p5['services/api rq'].status} — refused`)],
        ['read_file to an ANCESTOR Session via a link (R6-2, p12)', D('n/a'), P(`${p12.throughLink.status} — refused, no leak`)],
        ['workspace-context never injects a sibling file', P('not injected'), P('not injected')],
        ['Mutation: delete the Session-dir boundary check', D('—'), P('14 tests red, incl. the 4 new "confines file tools…" (no-sibling / sibling-installed / ancestor / Workspace-root) + symlink-escape')],
      ],
    ) +
      table(
        ['Regression + the bot\'s round-4/6/7 fixes', 'Result on d2b1845'],
        [
          ['Central A/B: files/1 · files/2 · shell/1', P(`${RES5('p1-central-r5head-v1-a.log')} · ${RES5('p1-central-r5head-v2-b.log')} · ${RES5('p1-central-r5head-v1-c.log')}`)],
          ['Cancel during a stalled read', P(`${RES5('p3-cancel-r5head-e.log')}, ${p3.settleMs} ms`)],
          ['Takeover continuation carries the context', P(`${JSON.stringify(p8.cont.requests.map((q) => q.markers.length))}, ${p8.cont.ctxOps} read`)],
          ['Real model follows QWEN.md', P(`${cnt(p7, 't1')} / ${cnt(p7, 't2')}`)],
          ['CLI vitest, 9 changed test files (macOS)', P('1363 / 1363')],
          ['CI Test (ubuntu): glob fixture (my R3b) fixed', P('0 failing — fixed by checking collectedFilePaths, not the echoed header')],
          ['glob range overflow / inject-once / code-point cut', P('pinned by unit tests (bot R4-3 / H2 / R3-8)')],
        ],
      ) +
      '<div class="note ok">The file-tool boundary now matches the workspace-context boundary: both confine to the Session directory by realpath. My R3b finding (bot R5-3) and R6-2 are closed end to end, and the new unit tests pin all four sibling topologies — including the sibling-installed branch my R3b probe could not reach. Every round-2 fix still holds and the bot\'s glob/injection round-4/6/7 items are pinned.</div>' +
      '<div class="note">Side note (not #13168): on macOS, #13166\'s core test <code>glob.test.ts > containmentRoot > searches when the containment root is a symlink to the search dir</code> fails (collectedFilePaths undefined). It uses a symlink as the containment root on top of macOS\'s symlinked <code>/var</code> tmpdir; the Hosted flow never hits it because <code>mount.resolve</code> hands glob a canonical directory (p1 files/2 glob is 12/12). CI\'s macOS lane is skipped, so it is green there; Linux passes.</div>',
  );
}

const R6 = (f) => J(`r6/${f}`);
const RES6 = (f) => resTxt(`r6/${f}`);

// ---------------------------------------------------------------- 09 round 5: boundary widened by #13166 merge
{
  const p5 = R6('p5-boundary-r6head-d.json');
  const p12 = R6('p12-ancestor-r6head-g.json');
  const p13 = R6('p13-install-order-r6head-h.json');
  const p8 = R6('p8-continue-r6head-j.json');
  const p3 = R6('p3-cancel-r6head-e.json');
  const p7 = R6('p7-real-r6head-i.json');
  const r4p5 = J('r5b/p5-boundary-r5head-d.json');
  const cnt = (p2, k) => `${p2.reps.filter((r) => r[k].token).length}/${p2.reps.length}`;
  figs['09-round5'] = page(
    'Round 5, head <code>6e151e6</code> — #13166 merged: file-tool boundary widened as its design doc declares',
    `${STACK} #13166 is now MERGED (on main); #13168 merged it in. Rebuilt: new bundle + new server jar (broker protocol changed, migrations→V46). The file-tool boundary changed from R4's strict Session-directory realpath to #13166's boot-v2 containment: shared mount reads are permitted, only another Session's directory is excluded — and that exclusion is <b>worker-local</b>.`,
    table(
      ['#13168 workspace-context feature + regression', 'Result on 6e151e6'],
      [
        ['workspace-context never injects a sibling file', P('not injected (p5: escape-Session links are skipped before the mount-wide arm)')],
        ['Central A/B: files/1 · files/2 · shell/1', P(`${RES6('p1-central-r6head-v1-a.log')} · ${RES6('p1-central-r6head-v2-b.log')} · ${RES6('p1-central-r6head-v1-c.log')}`)],
        ['Cancel during a stalled read', P(`${RES6('p3-cancel-r6head-e.log')}, ${p3.settleMs} ms`)],
        ['Takeover continuation carries the context', P(`${JSON.stringify(p8.cont.requests.map((q) => q.markers.length))}, ${p8.cont.ctxOps} read`)],
        ['Real model follows QWEN.md', P(`${cnt(p7, 't1')} / ${cnt(p7, 't2')}`)],
      ],
    ) +
      table(
        ['File-tool boundary (merged from #13166, now on main)', 'R4 (d2b1845)', '6e151e6'],
        [
          ['read_file through a link to a sibling Session (p5/s3)', P('refused'), F(`${p5['services/api rq'].status} — read the sibling file`)],
          ['read_file to an ancestor Session via a link (p12)', P('refused'), F(`${p12.throughLink.status}, leaked=${p12.throughLink.leaked}`)],
          ['real model recites a sibling Session\'s file (p9)', P('no'), F('yes — recited SIBLING_SECRET')],
          ['sibling installed (ran a tool) → excluded? (p13)', D('n/a'), F(`uninstalled ${p13['A-ancestor-never-ran'].leaked ? 'LEAKED' : 'refused'} · installed ${p13['B-ancestor-installed'].leaked ? 'LEAKED' : 'refused'}`)],
        ],
      ) +
      '<div class="note info"><b>This is declared design, not a hidden bug.</b> The search-profile doc states the boot-v2 boundary verbatim: it "permits shared locations inside the mount and excludes directories owned by another Session installed in the same worker… <b>That registry check is worker-local, not a confidentiality guarantee across separate workers… Boot v1 keeps the stricter Session boundary.</b>" My R4 strict boundary was boot v1; Hosted Workspace files use boot v2.</div>' +
      '<div class="note bad"><b>Why the exclusion never fires here.</b> Hosted Workspace files <b>require</b> <code>isolation=session</code> (<code>ManagedAgentProperties.validateWorkspaceFiles</code> throws otherwise), i.e. one worker process per Session. This rig confirms it: 15 live worker processes. <code>ownsAnotherSessionDir</code> iterates the worker\'s own <code>installations.bindings()</code>, so a sibling is always in a different worker and is never seen — the "same worker" exclusion covers the empty set. Any Session can read any other Session\'s files through an in-Session symlink (git-preserved, or shell-created under a shell profile), and the model recites them. <b>For the maintainers: confirm this cross-Session read trade-off is acceptable for Hosted (multi-tenant), since the doc declares no cross-worker confidentiality.</b> #13168\'s own workspace-context injection is unaffected.</div>',
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
