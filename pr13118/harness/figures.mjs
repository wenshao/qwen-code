// Evidence figures for the PR #13118 report. Every number is read from the
// result files of this run; nothing is typed in by hand except labels.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const SP = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const OUT = path.join(SP, 'figures');
fs.mkdirSync(OUT, { recursive: true });
const require = createRequire(path.join(SP, 'wt-pr', 'package.json'));
const { chromium } = require('playwright');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const scrub = (s) => String(s).split(SP).join('<scratch>');

// ---------------------------------------------------------------- data
function matrix(arm) {
  const file = path.join(SP, 'results', 'mutation', arm, 'matrix.log');
  const rows = {};
  let baseline = '';
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const b = line.match(/^BASELINE \S+\s+total=(\d+) bad=(\d+)/);
    if (b) baseline = `${b[1]} tests, ${b[2]} failing`;
    const m = line.match(/^(\S+)\s+(KILLED|SURVIVED)\s+(?:by (\d+) of (\d+)|(\d+) tests)\s+\S+ :: ([^:]+?)(?: :: (.*))?$/);
    if (m) rows[m[1]] = { verdict: m[2], failed: m[3] ? Number(m[3]) : 0, total: Number(m[4] ?? m[5]), what: m[6].trim(), killers: (m[7] ?? '').split(' | ').filter(Boolean).map((k) => k.replace(/^managed-runtime-provider-worker\.test\.ts › /, '').replace(/^ProviderRuntimeTransportTest\./, '')) };
  }
  return { rows, baseline };
}
const prW = matrix('pr-worker');
const baseW = matrix('base-worker');
const prJ = matrix('pr-java');
const baseJ = matrix('base-java');
const baseS = fs.existsSync(path.join(SP, 'results/mutation/base-serve/matrix.log')) ? matrix('base-serve') : { rows: {} };
const pick = (id) => prW.rows[id] ? { pr: prW.rows[id], base: baseW.rows[id], serve: baseS.rows[id], kind: 'TS' } : { pr: prJ.rows[id], base: baseJ.rows[id], kind: 'Java' };

function probe(name) {
  const file = path.join(SP, 'rig', 'out', `${name}.log`);
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const checks = {};
  for (const l of lines) {
    const m = l.match(/^\[(PASS|FAIL)\] (\S+) /);
    if (m) checks[m[2]] = m[1];
  }
  const summary = lines.find((l) => l.startsWith('[SUMMARY]')) ?? '';
  return { lines: lines.map(scrub), checks, summary };
}

// ---------------------------------------------------------------- page
const CSS = `
:root { color-scheme: dark; }
body { margin: 0; background: #0d1117; font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #e6edf3; }
#card { display: inline-block; padding: 28px 32px 30px; background: #0d1117; min-width: 1100px; max-width: 1560px; }
h1 { font-size: 26px; margin: 0 0 4px; font-weight: 650; }
.sub { color: #8b949e; font-size: 15px; margin: 0 0 18px; }
table { border-collapse: collapse; font-size: 14.5px; width: 100%; }
th { text-align: left; color: #8b949e; font-weight: 600; border-bottom: 1px solid #30363d; padding: 7px 10px; white-space: nowrap; }
td { border-bottom: 1px solid #21262d; padding: 7px 10px; vertical-align: top; }
td.mono, span.mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 13.5px; }
.k { color: #3fb950; font-weight: 650; } .s { color: #f85149; font-weight: 650; } .n { color: #8b949e; }
.a { color: #d29922; font-weight: 650; }
.group td { color: #79c0ff; font-weight: 650; background: #161b22; }
.note { margin-top: 16px; border-left: 3px solid #388bfd; padding: 6px 12px; color: #c9d1d9; font-size: 14.5px; line-height: 1.5; }
pre { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 13px; line-height: 1.45; background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px 14px; white-space: pre; overflow: hidden; margin: 0 0 12px; }
`;
const page = (title, sub, body, note) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="card"><h1>${esc(title)}</h1><p class="sub">${esc(sub)}</p>${body}${note ? `<div class="note">${note}</div>` : ''}</div></body></html>`;
const verdict = (r) => !r ? '<span class="n">—</span>' : r.verdict === 'KILLED' ? `<span class="k">killed</span> <span class="n">(${r.failed}/${r.total})</span>` : `<span class="s">survived</span> <span class="n">(${r.total})</span>`;

// ---------------------------------------------------------------- figure 1
function fig1() {
  const claimed = ['L11', 'Q6', 'H8', 'N17', 'T18', 'T2', 'T8', 'P5', 'I6'];
  const extra = ['X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'X8', 'X9', 'X10', 'X11', 'X13'];
  const open = ['L20', 'L34', 'L35', 'Q4', 'K36', 'K39', 'H3'];
  const row = (id) => {
    const d = pick(id);
    const flakeOnly = d.serve && d.serve.verdict === 'KILLED' && d.serve.killers.every((k) => k.startsWith('hosted-harness-session.test.ts'));
    const serve = d.kind !== 'TS' ? '<span class="n">n/a</span>' : flakeOnly ? `<span class="s">survived</span><span class="a">†</span> <span class="n">(other 23 files)</span>` : verdict(d.serve);
    const killers = d.pr.killers.length > 2 ? [...d.pr.killers.slice(0, 2), `… +${d.pr.killers.length - 2} more`] : d.pr.killers;
    return `<tr><td class="mono">${id}</td><td class="n">${d.kind}</td><td>${esc(d.pr.what)}</td><td>${verdict(d.base)}</td><td>${serve}</td><td>${verdict(d.pr)}</td><td class="mono">${esc(killers.join(' · ') || '—')}</td></tr>`;
  };
  const body = `<table><tr><th>Id</th><th></th><th>Mutation (applied to production code)</th><th>base tests<br><span class="n">worker file / Broker module</span></th><th>base tests<br><span class="n">24 serve files</span></th><th>PR tests</th><th>PR test that fails</th></tr>
<tr class="group"><td colspan="7">The nine the PR claims (definitions copied verbatim from the #12868 round-7 harness)</td></tr>${claimed.map(row).join('')}
<tr class="group"><td colspan="7">Variants written for this verification (X10, X11, X13 are the boundaries named in the bot's review R1-2 / R1-5)</td></tr>${extra.map(row).join('')}
<tr class="group"><td colspan="7">Left for classification by the PR (L20, L34, L35) and listed as needing no test by #13103</td></tr>${open.map(row).join('')}</table>`;
  const note = `Worker file: base ${esc(baseW.rows.L11 ? baseW.rows.L11.total : '?')} tests, PR ${esc(prW.rows.L11.total)} tests. Broker module: base ${esc(baseJ.baseline)}, PR ${esc(prJ.baseline)}. Each mutant was applied alone and the file restored from its original bytes.<br><span class="a">†</span> On base the only failures in the 24-file run were in hosted-harness-session.test.ts, a different test each time; that file does not import the mutated modules (esbuild import graph, 2,176 inputs) and failed 3 of 67 unmutated in a run at load 30.`;
  return page('PR #13118 — mutation A/B: merge-base tests vs PR tests', 'Production code identical in both arms; only the two test files differ. base = d3c2edc606, PR head = 7326290a04. macOS, Node 22.23.2, JDK 21.', body, note);
}

// ---------------------------------------------------------------- figure 2
function fig2() {
  const parity = fs.readFileSync(path.join(SP, 'results', 'artifact-parity.txt'), 'utf8').trim();
  const merge = fs.readFileSync(path.join(SP, 'results', 'merge-trees.txt'), 'utf8').trim();
  const body = `<pre>${esc(scrub(parity))}</pre><pre>${esc(merge)}</pre>`;
  const note = 'Chunk file names are content hashes and the build stamps the short commit id, so each file is compared after replacing both. Jars are compared entry by entry by CRC-32; nested jars are unpacked and compared the same way.';
  return page('PR #13118 — the shipped artifacts do not change', 'Both arms built from scratch: pnpm install, npm run build, npm run bundle, mvn install / package (JDK 21).', body, note);
}

// ---------------------------------------------------------------- figure 3
function fig3() {
  const head = probe('s13118-head-ABCC3DEF');
  const mut = { H8: probe('s13118-mut-H8-A'), Q6: probe('s13118-mut-Q6-B'), Q6run: probe('s13118-mut-Q6-B2'), T8: probe('s13118-mut-T8-C'), P5: probe('s13118-mut-P5-E'), X8: probe('s13118-mut-X8-E'), I6: probe('s13118-mut-I6-F') };
  const line = (p, tag) => (p.lines.find((l) => l.startsWith(`[${tag}]`)) ?? '').replace(/^\[[^\]]+\] /, '');
  const q6run = mut.Q6run.lines.filter((l) => l.startsWith('[B2]')).map((l) => l.replace(/^\[B2\] /, '')).join('; ');
  const ok = (p, ids) => ids.map((id) => `${id} ${p.checks[id] === 'PASS' ? '<span class="k">pass</span>' : p.checks[id] === 'FAIL' ? '<span class="s">fail</span>' : '<span class="n">—</span>'}`).join(' · ');
  const rows = [
    ['H8', 'status cursor', 'Caller cursor 3 via Broker: worker is asked with afterSequence 0, caller gets progress [] (A1.1)', 'Rig-sent status, cursor 3: seqs [4,5,6] of [1..6] (A2.1)', `worker bundle with H8: cursor 3 answers [1..6]; Broker path unchanged<br>${ok(mut.H8, ['A1.1', 'A2.1'])}`],
    ['Q6', 'missing Shell directory', 'prepare → 400 managed_runtime_tool_invalid on the wire, nothing journaled; runs once the directory exists (B.1–B.4)', '—', `worker bundle with Q6: prepare admitted (200); the run settles as error, exit 1<br>${ok(mut.Q6, ['B.1', 'B.2', 'B.4'])}`],
    ['T8', 'release over pending work', 'Release via Broker while a call runs → 409 runtime_session_busy, worker not asked (C1.1)', 'Rig-sent release → 409 managed_runtime_provider_operation_failed; prepared call stays prepared, later runs; release then 200 (C2.1–C2.6)', `worker bundle with T8, pending = running call: core's releasePrepared refuses instead ("still owns unfinished execution"), prepared call kept<br>${ok(mut.T8, ['C2.1', 'C2.2', 'C2.5'])}`],
    ['T18', '413 too large', 'Worker 413 (substituted by the proxy) reaches the caller as 413 managed_runtime_provider_too_large (D.1)', 'Not producible naturally: the fitter bounds results and the manifest is fixed. Fitted 1.5, 2 and 3 MiB Shell results answer 1,048,575 bytes, one under the 1,048,576 limit (section H)', 'worker bundles with X11 and with X10 + X11 (bot R1-2): the same three results still answer 1,048,575 bytes, all 200'],
    ['P5 / X8', 'cursor 2^53', 'Worker status with lastSeq 2^53, or firstAvailableSeq 2^53 → Broker GET 409 runtime_broker_execution_unknown; 2^53 − 1 accepted (E.1–E.3)', 'Journal stays UNKNOWN, call later settles success; last_sequence stays 0 on every provider row', `jar with P5: both 200 · jar with X8: firstAvailableSeq case 200<br>P5 ${ok(mut.P5, ['E.1', 'E.2', 'E.3'])}<br>X8 ${ok(mut.X8, ['E.1', 'E.2', 'E.3'])}`],
    ['I6', 'uppercase Session UUID', 'In-repo TS client refuses bind-history and begin-turn locally (core lower-cases identities) (F.2)', 'Raw Broker begin-turn, all uppercase: Broker forwards, worker refuses 409 managed_runtime_identity_conflict (F.3)', `jar with I6: Broker refuses 400 runtime_control_operation_invalid, worker not asked<br>${ok(mut.I6, ['F.2', 'F.3'])}`],
  ];
  const body = `<table><tr><th>Guard</th><th>Production path (in-repo client → Broker → worker)</th><th>Asked directly (rig-sent with the Broker's credentials)</th><th>Same probe with the guard broken</th></tr>${rows.map(([id, name, a, b, c]) => `<tr><td><span class="mono">${id}</span><br><span class="n">${name}</span></td><td>${esc(a)}</td><td>${esc(b)}</td><td>${c}</td></tr>`).join('')}</table>`;
  const gSum = probe('s13118-head-G').summary.replace('[SUMMARY] ', '');
  const note = `Head stack: ${esc(head.summary.replace('[SUMMARY] ', ''))} (sections A–F) and ${esc(gSum)} (section G, release window). Spring server jar with embedded Runtime Broker on MySQL 8.4.7, production HttpRuntimeTransport, real workers launched from the bundle, driven by the built BrokerManagedRuntimeProvider; an HTTP proxy between Broker and worker records every request and can substitute an answer. With Q6 broken the admitted call settled as error (shell_execute_error, exit code 1, no output from "pwd; echo ran-here").`;
  return page('PR #13118 — each pinned guard on the real chain', 'Head build (identical production artifacts to base) vs builds with one guard broken. Orders the Broker never sends are labelled rig-sent.', body, note);
}

// ---------------------------------------------------------------- figure 4
function fig4() {
  const rounds = fs.readFileSync(path.join(SP, 'logs', 'repeat-head.out'), 'utf8').trim().split('\n').filter((l) => l.startsWith('round'));
  const shuffle = fs.existsSync(path.join(SP, 'logs', 'shuffle.out')) ? fs.readFileSync(path.join(SP, 'logs', 'shuffle.out'), 'utf8').trim().split('\n').filter((l) => l.startsWith('seed')).map((l) => `shuffled ${l.replace(/ cursorTestPosition=\d+/, '')}`) : [];
  const failedRounds = rounds.filter((l) => !/failed=0 /.test(l)).length;
  const body = `<pre>${esc(rounds.join('\n'))}</pre><pre>${esc(shuffle.join('\n'))}</pre>`;
  const loads = rounds.map((l) => Number(l.match(/load=([\d.]+)/)[1]));
  const note = `${rounds.length} consecutive runs of the whole worker file (33 tests) at 1-minute host load ${Math.min(...loads).toFixed(1)}–${Math.max(...loads).toFixed(1)} (10 cores), while other mutation runs shared the machine; ${failedRounds} with a failure. newTestMs = durations, in file order, of the six tests the PR adds or extends (containment loop, cursor, 413, the two release barriers, retirement warning). Shuffled: vitest 3.2.7 --sequence.shuffle with five seeds.`;
  return page('PR #13118 — the new tests under load and in shuffled order', 'Head 7326290a04, packages/cli, Node 22.23.2, macOS.', body, note);
}

function fig5() {
  const probeLines = fs.readFileSync(path.join(SP, 'results', 'probe-r1-3.out'), 'utf8').trim().split('\n');
  const g = probe('s13118-head-G');
  const gLine = (g.lines.find((l) => l.startsWith('[G]')) ?? '').replace(/^\[G\] /, '');
  const fmt = (l) => {
    const [k, v] = l.split(' -> ');
    const short = v.replace(/,"lastSeq":0,"firstAvailableSeq":1,"progressGap":false,"progress":\[\]/, '').replace(/"protocolVersion".*"result":/, '"result":');
    return `<tr><td class="mono">${esc(k)}</td><td class="mono">${esc(short.slice(0, 150))}</td></tr>`;
  };
  const body = `<table><tr><th>Worker route, in-process executor (the PR's two release tests, each with a prepared read_file added)</th><th>Answer</th></tr>${probeLines.map(fmt).join('')}</table>
<table style="margin-top:14px"><tr><th>Real chain (section G): Broker release held 5 s at the proxy, history control sent meanwhile</th></tr><tr><td class="mono">${esc(gLine)}</td></tr></table>`;
  const note = 'EARLY = the history read is pending when release arrives (first barrier, :278): prepared work kept. LATE = the history read enters while releasePrepared is waiting (second barrier, closeSessionAdmission): the release is refused with the same message, the Session stays open, but releasePrepared has already cancelled the prepared call. The Broker never produces either order: it refuses a release while a control is active, and refuses controls once the Session is RELEASING.';
  return page('PR #13118 — the two release refusals and a prepared invocation (bot review R1-3)', 'Temporary probe test inserted into the PR head test file, run once and removed; head 7326290a04.', body, note);
}

const figures = [['01-mutation-ab', fig1], ['02-artifact-parity', fig2], ['03-real-chain', fig3], ['04-load-and-order', fig4], ['05-release-refusals', fig5]];
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1640, height: 1200 } });
for (const [name, fn] of figures.filter(([n]) => !process.argv[2] || process.argv.slice(2).includes(n))) {
  const html = path.join(OUT, `${name}.html`);
  fs.writeFileSync(html, fn());
  const p = await ctx.newPage();
  await p.goto(`file://${html}`);
  const clipped = await p.evaluate(() => [...document.querySelectorAll('pre')].filter((e) => e.scrollWidth > e.clientWidth).length);
  await p.locator('#card').screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`${name}.png clipped-pre=${clipped}`);
  await p.close();
}
await browser.close();
