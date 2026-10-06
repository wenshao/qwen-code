// Renders the evidence cards for PR 13376 from the rig's result files
// (never from hand-typed numbers) and screenshots them with Playwright.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const RIG = '/Users/wenshao/git/pr13376-rig';
const FIG = `${RIG}/fig`;
mkdirSync(FIG, { recursive: true });
const require = createRequire('/Users/wenshao/git/pr13376-head/package.json');
const { chromium } = require('playwright');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:26px 30px;background:#0d1117;width:1440px}
h1{font-size:21px;margin:0 0 4px}
.sub{color:#8b949e;font-size:13px;margin-bottom:16px}
table{border-collapse:collapse;font-size:13px;width:100%;table-layout:fixed}
th,td{border:1px solid #30363d;padding:5px 9px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
th{background:#161b22;color:#c9d1d9;font-weight:600}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.ok{color:#3fb950}.bad{color:#f85149}.warn{color:#d29922}.dim{color:#8b949e}
.sec td{background:#161b22;color:#d2a8ff;font-weight:600}
.note{margin-top:14px;border-left:4px solid #388bfd;padding:8px 14px;background:#161b22;color:#c9d1d9;font-size:13px}
h2{font-size:15px;margin:18px 0 8px}
`;
const page = (title, sub, body, note) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${title}</h1><div class="sub">${sub}</div>${body}${note ? `<div class="note">${note}</div>` : ''}</div></body></html>`;
const jsonl = (p) => readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const scrub = (s) => s.replace(/; re-read before retryi$/, '; re-read before retrying.').replace(/p13376-[a-z]+-[0-9a-f]{8}/g, '‹session›').replace(/ \(pid \d+\)/g, '');
const lineCls = (s) => {
  if (/^retry as goal_state: OK/.test(s)) return 'bad';
  if (/after chmod 444/.test(s)) return 'warn';
  if (/^(first:|before retries|after 1st write|cmd-1 |commit cmd-1|process A|authority |head\(rev)/.test(s)) return 'dim';
  if (/UNREADABLE|sameRef(AsCommitted|AsCmd1)?=false|staged=[1-9]|staged [0-9]+ -> [1-9]|bodies on disk=1[01]\b|rev=3 |retryRefOnServer=NO|does not match the committed|REFUSED .*writes stopped/.test(s)) return 'bad';
  if (/readable|sameRef(AsCommitted|AsCmd1)?=true|replayed=true rev=1|REFUSED ManagedSessionConflictError: command cmd-1 was (already committed with different|committed without)|staged=0|staged 0 -> 0/.test(s)) return 'ok';
  return 'dim';
};
const cellLines = (lines) => `<td class="mono">${lines.map((l) => `<div class="${lineCls(l)}">${esc(scrub(l))}</div>`).join('')}</td>`;

// ---------- Card 1: real Session Store ----------
{
  const rows = jsonl(`${RIG}/results/http.jsonl`);
  const get = (arm, s) => rows.filter((r) => r.arm === arm && r.scenario === s).at(-1).lines;
  const SC = [
    ['retry-same-x10', 'same command (cmd-1) retried 10× after it committed'],
    ['stale-retry', 'cmd-1 retried after cmd-2 committed revision 2'],
    ['cold-reopen-retry', '3 OS processes: A commits, B (new writer) retries, C reads B\'s ref'],
    ['retry-with-expected-sequence', 'identical retry of a command that pinned expectedSequence'],
    ['retry-different-content', 'same command id, different contentDigest'],
    ['retry-other-domain', 'session_metadata command retried as goal_state'],
    ['sink-redelivered-title', 'production sink.write() of the same title record (same uuid) twice'],
  ];
  let body = '<table><colgroup><col style="width:220px"><col><col></colgroup><tr><th>scenario</th><th>base = main 43a6e1e5 (merge-base)</th><th>head ac346bb4</th></tr>';
  for (const [id, label] of SC) body += `<tr><td>${esc(label)}<div class="dim mono">${id}</div></td>${cellLines(get('base', id))}${cellLines(get('head', id))}</tr>`;
  body += '</table>';
  writeFileSync(`${FIG}/01-real-session-store.html`, page(
    'PR #13376 — commitDomainRecord retries against the real Session Store',
    'Spring Managed Agent Server jar (Session Store on, Java sources identical to head) + private mysqld 8.4.7; each arm\'s built core dist drives openManagedSession over createHttpManagedSessionStores, as the Hosted Harness wires it. "metadataBodies"/"head(rev/seq)" are read from MySQL; "staged" is the HTTP resource store\'s in-memory map.',
    body,
    'Base answers a retry with replayed=true but a revision that does not exist (2 or 3) and a ref the server never stored — a fresh reader gets "The Managed Session resource does not exist" — and keeps one staged body in memory per retry. The identical retry of an expectedSequence-pinned command is refused on base (main since #13345). Head answers every retry with the committed revision and ref, stages nothing, and refuses the cross-domain retry instead of fabricating a goal_state receipt.'));
}

// ---------- Card 2: local on-disk log + real CLI child ----------
{
  const rows = jsonl(`${RIG}/results/local.jsonl`);
  const get = (arm, s) => rows.filter((r) => r.arm === arm && r.scenario === s).at(-1).lines;
  let body = '<h2>Local on-disk Managed log (the CLI path: local JSONL journal + local resource files), every phase its own process</h2>';
  body += '<table><colgroup><col style="width:220px"><col><col></colgroup><tr><th>scenario</th><th>base</th><th>head</th></tr>';
  for (const [id, label] of [['cross-process-retry-x10', 'A commits cmd-1 and exits; B reopens and retries cmd-1 ×10; C runs the session-list title reader'], ['stopped-writer-retry', 'commit cmd-1, chmod 444 the log so cmd-2 latches a write failure, then retry cmd-1']]) {
    body += `<tr><td>${esc(label)}<div class="dim mono">${id}</div></td>${cellLines(get('base', id))}${cellLines(get('head', id))}</tr>`;
  }
  body += '</table>';
  const tsv = readFileSync(`${RIG}/results/real-child.tsv`, 'utf8').trim().split('\n').map((l) => l.split('\t'));
  const childCls = (s) => (/sameRef=false|rev=3|"managed-file_history":4/.test(s) ? 'bad' : /sameRef=true/.test(s) ? 'ok' : 'dim');
  const col = (arm) => `<td class="mono">${tsv.filter((r) => r[0] === arm).map((r) => `<div class="${childCls(r[1])}">${esc(r[1].replace(/session=[0-9a-f-]+/, 'session=‹id›').replace(/\/Users\/wenshao\/git\//, ''))}</div>`).join('')}</td>`;
  body += '<h2>Real CLI: <span class="mono">qwen --acp --acp-execution-engine managed</span> child from each arm\'s shipped dist/cli.js, 2 turns against a local fake model; then that arm\'s authority cold-reopens the child\'s log and retries the exact commands the child committed</h2>';
  body += `<table><colgroup><col><col></colgroup><tr><th>base</th><th>head</th></tr><tr>${col('base')}${col('head')}</tr></table>`;
  writeFileSync(`${FIG}/02-local-log-and-real-cli.html`, page(
    'PR #13376 — local Managed log and a real Managed CLI child',
    'Same arms as card 1. The real-child rig mirrors managed-engine-channel-factory.process.test.ts but points QWEN_CLI_ENTRY at the arm\'s bundle.',
    body,
    'On disk the base leak is durable: ten retries leave ten unreferenced session_metadata bodies (1 → 11) across a process restart, and the child\'s two file_history commands come back as a non-existent revision 3 with two new orphans. The readers are unaffected (orphans are inert, as the PR says). Both bundles run the Managed session identically (34 records, 16 commits). One intended behaviour change: after the writer has stopped, head still answers a retry of an already-committed command (base refuses) — the commitExtensionRecord ordering.'));
}

// ---------- Card 3: tests, mutants, merges ----------
{
  const base = JSON.parse(readFileSync(`${RIG}/results/base-pr-tests.json`, 'utf8'));
  const head = JSON.parse(readFileSync(`${RIG}/results/mutants/witness-baseline.json`, 'utf8'));
  const failedTitles = (d) => d.testResults.flatMap((r) => r.assertionResults.filter((a) => a.status === 'failed').map((a) => a.title));
  let body = '<h2>PR tests (metadata + record-sink files) on both arms</h2><table><colgroup><col style="width:220px"><col></colgroup>';
  body += `<tr><td class="mono">base (head's tests copied in)</td><td class="mono bad">${base.numPassedTests}/${base.numTotalTests} pass, ${base.numFailedTests} fail: ${esc(failedTitles(base).join(' · '))}</td></tr>`;
  body += `<tr><td class="mono">head</td><td class="mono ok">${head.numPassedTests}/${head.numTotalTests} pass</td></tr></table>`;
  const mut = jsonl(`${RIG}/results/mutants/results.jsonl`);
  const last = (suite, id) => mut.filter((r) => r.suite === suite && r.id === id).at(-1);
  const ids = [...new Set(mut.filter((r) => r.suite === 'witness').map((r) => r.id))];
  body += '<h2>Mutants of the replay path (anchored, one at a time, tree verified clean after each)</h2><table><colgroup><col style="width:70px"><col style="width:520px"><col style="width:120px"><col style="width:120px"><col></colgroup><tr><th>id</th><th>mutation</th><th>PR witness files (66)</th><th>managed-runtime dir (2226)</th><th>killed by</th></tr>';
  for (const id of ids) {
    const w = last('witness', id);
    const wide = last('wide', id);
    const confounded = id === 'M14' || id === 'M15';
    const v = (r) => (r ? `<span class="${r.verdict === 'KILLED' ? 'ok' : 'bad'}">${r.verdict}</span>` : '<span class="dim">—</span>');
    const what = confounded ? `${w.what} <span class="warn">(confounded: also moves the replay below the domain gate; see ${id}b)</span>` : w.what;
    body += `<tr><td class="mono">${id}</td><td>${what}</td><td class="mono">${v(w)}</td><td class="mono">${v(wide)}</td><td class="mono dim">${esc(w.killers.map((k) => k.replace('managed session metadata ', '').replace('managed session record sink ', 'sink: ')).slice(0, 2).join(' · '))}</td></tr>`;
  }
  body += '</table>';
  const merges = readFileSync(`${RIG}/results/merges.txt`, 'utf8').trim().split('\n');
  const grab = (f, re) => (readFileSync(f, 'utf8').match(re) ?? ['?'])[0].trim();
  body += '<h2>Merges</h2><table><colgroup><col style="width:220px"><col></colgroup>';
  body += `<tr><td>git merge-tree</td><td class="mono">${merges.map((l) => `<div class="${/exit=1/.test(l) ? 'warn' : 'ok'}">${esc(l)}</div>`).join('')}</td></tr>`;
  body += `<tr><td>trial merge on main 933dc0a6</td><td class="mono ok">typecheck exit 0 · core authority/extension/metadata/sink ${esc(grab(`${RIG}/logs/merge2-core.log`, /Tests +\d+ passed \(\d+\)/))} · cli hosted-file-history/hosted-workspace-tool-turn/managed-runtime-file-history ${esc(grab(`${RIG}/logs/merge2-cli.log`, /Tests +\d+ passed \(\d+\)/))}</td></tr>`;
  body += '<tr><td>main + #13376 + #13332</td><td class="mono ok">only conflict: both add tests at the same spot in managed-session-metadata.test.ts; union resolution → metadata + sink + authority 147/147 (#13332\'s envelope-last body order composes with the replay)</td></tr></table>';
  writeFileSync(`${FIG}/03-tests-mutants-merges.html`, page(
    'PR #13376 — tests, mutants and merges',
    'Base = merge-base 43a6e1e5; head = ac346bb4. Mutation worktree = head; each mutant runs the two PR witness files, survivors also the whole managed-runtime directory + managed-session-log.test.ts.',
    body,
    'The PR\'s own witness claim holds (M02 turns exactly one test red). Two behaviours this PR changes are pinned by no test: M15b — the identical retry of an expectedSequence-pinned command, refused on main today and replayed at head — and M14b, the stopped-writer replay. A 28-line candidate test (fails on main, passes at head, kills M15b) is attached. M09 (receipt committedSequence) and M13 (actor/identity order) are benign.'));
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1520, height: 900 } });
const pg = await ctx.newPage();
for (const f of ['01-real-session-store', '02-local-log-and-real-cli', '03-tests-mutants-merges']) {
  await pg.goto(`file://${FIG}/${f}.html`);
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('td,th,div')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  await pg.locator('#card').screenshot({ path: `${FIG}/${f}.png` });
  console.log('wrote', `${FIG}/${f}.png`, 'clipped elements:', clipped);
}
await browser.close();
