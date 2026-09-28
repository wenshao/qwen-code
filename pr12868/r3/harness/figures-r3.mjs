// Round-3 evidence figures for PR #12868. Everything shown is read from the
// run logs in out/ and from git; titles and notes are the only hand-written text.
// usage: node figures-r3.mjs [card ids]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const RIG = path.dirname(new URL(import.meta.url).pathname);
const SP = path.dirname(RIG);
const OUT = path.join(SP, 'figures');
fs.mkdirSync(OUT, { recursive: true });
const require = createRequire(path.join(SP, 'wt-pr', 'package.json'));
const { chromium } = require('playwright');
const HEAD = 'ac0b6cf966';
const PREV = 'f0f217dfa5';
const MAIN = 'd66fdadd27';

const log = (name) => fs.readFileSync(path.join(RIG, 'out', name), 'utf8').split('\n');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tidy = (s) => s.replace(/\/private\/tmp\/claude-501\/[^ "]*?\/rig\/roots[-a-z0-9]*/g, '<roots>').replace(/\/private\/tmp\/claude-501\/[^ "]*?\/scratchpad/g, '<rig>').replace(/\/private\/tmp\/claude-501\/[^ "]*/g, '<rig>/…');
const strip = (s) => s.replace(/BrokerResponseError:( Managed)?( Runt\w*)?( Broker)?( returne?d?)?( HT\w*)?( \d+\.?)?/g, '').replace(/BrokerRespons\w*/g, '').replace(/refused status=(\d+) code=/g, 'refused $1 ').replace(/\s+/g, ' ');
// merge-tree exits 1 when the merge has conflicts; its output is still what is wanted.
const git = (...args) => spawnSync('git', args, { cwd: path.join(SP, 'wt-pr'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout;

const css = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #0d1117; font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; }
  #card { width: 1560px; padding: 28px 32px 30px; background: #0d1117; color: #e6edf3; box-sizing: border-box; }
  h1 { font-size: 25px; margin: 0 0 4px; font-weight: 650; letter-spacing: -0.2px; }
  .sub { color: #8b949e; font-size: 15px; margin-bottom: 18px; line-height: 1.45; }
  h2 { font-size: 16px; color: #79c0ff; margin: 20px 0 8px; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; font: 13.5px/1.45 ui-monospace, Menlo, monospace; }
  th { text-align: left; color: #8b949e; font-weight: 500; border-bottom: 1px solid #30363d; padding: 5px 10px 5px 0; }
  td { padding: 4px 10px 4px 0; border-bottom: 1px solid #21262d; vertical-align: top; overflow-wrap: break-word; }
  td.t { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; font-size: 14.5px; color: #e6edf3; }
  pre { margin: 0; font: 13.5px/1.5 ui-monospace, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px 14px; }
  .ok { color: #3fb950; } .bad { color: #f85149; } .warn { color: #d29922; } .dim { color: #8b949e; } .hl { color: #79c0ff; }
  .add { color: #3fb950; } .del { color: #f85149; }
  .note { border-left: 3px solid #1f6feb; padding: 6px 0 6px 12px; margin-top: 16px; color: #c9d1d9; font-size: 15px; line-height: 1.5; }
  .note.warn { border-left-color: #d29922; }
  .foot { color: #6e7681; font-size: 12.5px; margin-top: 16px; font-family: ui-monospace, Menlo, monospace; }
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${esc(title)}</h1><div class="sub">${sub}</div>${body}<div class="foot">${esc(`PR #12868 round 3 · head ${HEAD} = merge of ${PREV} with main ${MAIN} · macOS 26 arm64 · Node 22.23.2 · JDK 21.0.12 · MySQL 8.4.7 · Spring server jar + embedded Runtime Broker + bundled workers`)}</div></div>`;
const paint = (l) => esc(strip(tidy(l)))
  .replace(/^\[PASS\]/, '<span class="ok">[PASS]</span>').replace(/^\[FAIL\]/, '<span class="bad">[FAIL]</span>')
  .replace(/^(\[[A-Z]\d?[a-z]?-v[12]\])/, '<span class="dim">$1</span>');

const cards = {};

cards['r3-01-merge-anatomy'] = () => {
  const numstat = git('show', '--remerge-diff', '--format=', '--numstat', HEAD).trim().split('\n').map((l) => l.split('\t'));
  const conflicts = git('merge-tree', '--write-tree', '--name-only', PREV, MAIN).split('\n').slice(1).filter((l) => l && !l.includes(' ')).filter((l) => l.includes('/'));
  const mainFiles = git('diff', '--name-only', `${PREV}...${MAIN}`).trim().split('\n').length;
  const notes = {
    'broker-managed-runtime-provider.ts': 'both constructor parameters kept: reason (this PR) and abandoned (main); the call passes both',
    'WorkspaceRuntimeTest.java': 'both tests kept; the fixture returns a confirmed worker release and carries main’s extra fields',
    'RuntimeBrokerService.java': 'reservations go through main’s receipt lookup with this PR’s validated reference; cancel keeps asking the worker for a prepared provider call until the Session is released',
    'RuntimeBrokerServiceTest.java': 'added by hand: repeated cancellation, receipts after release, ABANDONED provider receipts',
    '2026-09-27-broker-provider-control.md': 'added by hand: terminal receipts, ABANDONED, what stays unavailable after release',
    '2026-09-27-broker-provider-control.zh-CN.md': 'the same three paragraphs in Chinese',
  };
  const rows = numstat.map(([add, del, file]) => {
    const name = path.basename(file);
    const conflicted = conflicts.some((c) => c === file);
    return `<tr><td>${esc(name)}</td><td>${conflicted ? '<span class="warn">conflict</span>' : '<span class="hl">edited beyond the conflicts</span>'}</td><td><span class="add">+${add}</span> <span class="del">−${del}</span></td><td class="t">${esc(notes[name] ?? '')}</td></tr>`;
  }).join('');
  const mechanical = git('merge-tree', '--write-tree', PREV, MAIN).split('\n')[0];
  const recorded = git('rev-parse', `${HEAD}^{tree}`).trim();
  const changedByMain = git('diff', '--numstat', `${PREV}...${MAIN}`, '--', 'packages/cli/src/serve/broker-managed-runtime-provider.ts', 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerService.java', 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerHttpServer.java').trim().split('\n').map((l) => l.split('\t')).map(([a, d, f]) => `${path.basename(f)} +${a} −${d}`).join(' · ');
  const service = git('diff', '--numstat', `${PREV}...${MAIN}`, '--', 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerService.java').trim().split('\t');
  const body = `<h2>git show --remerge-diff ${HEAD}: the difference between a mechanical merge and the recorded merge</h2>
  <table><tr><th style="width:26%">file</th><th style="width:16%">kind</th><th style="width:9%">lines</th><th>what was decided</th></tr>${rows}</table>
  <h2>Facts</h2><pre>parents                 ${PREV} (previous head)  +  ${MAIN} (main, #12839 on top)
main brought            ${mainFiles} files; in production files of this PR: ${esc(changedByMain)}
mechanical merge tree   ${mechanical.slice(0, 12)}  (3 files with conflict markers)
recorded merge tree     ${recorded.slice(0, 12)}
files that differ       ${numstat.length}: ${conflicts.length} conflicted + ${numstat.length - conflicts.length} edited beyond the conflicts (2 design documents, 1 test file)</pre>
  <div class="note">Unlike the merge in round 2, this one is not mechanical. No production line outside the three conflicted files was edited by hand; the extra edits are documentation and one test file. The production decisions are in <b>RuntimeBrokerService.java</b>, where main added ${service[0]} lines and removed ${service[1]} under this PR’s reserve, start and cancel paths.</div>`;
  return page('Anatomy of the merge commit', `Head ${HEAD} adds no feature commit. It merges main after #12839 (terminal receipts, Runtime-loss fences) with three conflicts resolved by hand.`, body);
};

cards['r3-02-receipts-and-cancel'] = () => {
  const pick = (name, re) => log(name).filter((l) => re.test(l)).map(paint).join('\n');
  const body = `<h2>Previous head ${PREV} · after release</h2><pre>${pick('s13-merge-prev-M1M2.log', /^\[M1-v2\] (before|after)|^\[M2-v2\]/)}</pre>
  <h2>This head ${HEAD} · after release (boot v2; boot v1 is identical)</h2><pre>${pick('s13-merge-pr-M1M2.log', /^\[M1-v2\]|^\[M2-v2\]|^\[(PASS|FAIL)\] M[12]-v2/)}</pre>
  <div class="note">Main’s terminal receipts now reach the provider path. A released Session answers <b>GET</b>, <b>cancel</b> and a repeated reservation for its terminal execution from the stored record: same execution id, no worker request, Session row unchanged. The receipt is bound to its owner and to its reference. New work, <b>start</b> and live controls stay refused. Before release every cancellation of a prepared provider call still reaches the worker, which is the behaviour the hand resolution had to keep.</div>`;
  return page('Seam 1: terminal receipts and repeated cancellation', 'Same probe on two builds, Spring Broker on MySQL 8.4.7, real workers. The previous head is the build before the merge.', body);
};

cards['r3-03-worker-death'] = () => {
  const pick = (name) => log(name).filter((l) => /^\[M3[pr]-v[12]\] /.test(l)).map((l) => paint(l.replace(/^\[M3[pr]-v[12]\] /, ''))).join('\n');
  const body = `<h2>Previous head ${PREV} · provider path · boot v2</h2><pre>${pick('s13-merge-prev-M3p-v2.log')}</pre>
  <h2>main ${MAIN} · raw path · boot v2 (main has no provider path)</h2><pre>${pick('s13-merge-main-M3r-v2.log')}</pre>
  <h2>This head ${HEAD} · raw path · boot v2</h2><pre>${pick('s13-merge-pr-M3r-v2.log')}</pre>
  <h2>This head ${HEAD} · provider path · boot v2</h2><pre>${pick('s13-merge-pr-M3p-v2.log')}</pre>
  <div class="note">The worker is killed with SIGKILL while one invocation is reserved. On every build nothing executes and nothing is replayed. What follows changed with main: the placement is <b>LOST</b> instead of FAILED, no replacement worker starts, and later placements are refused until recovery evidence exists. This head answers exactly as main does, line for line, on the raw path and on the provider path. The change is inherited from #12839; the merge neither weakened nor extended it.</div>`;
  return page('Seam 2: worker death under main’s Runtime-loss fences', 'Each scenario runs on its own fresh database and Broker, because a lost placement refuses later placements.', body);
};

cards['r3-04-regression'] = () => {
  const sum = (name) => (log(name).find((l) => l.startsWith('[SUMMARY]')) ?? '').slice(10);
  const driver = log('s9-author-driver-mysql-pr.log').filter((l) => /^\[(driver|driver-out|mysql|executions|release order)\]/.test(l)).map((l) => esc(l));
  const model = log('s6-hosted-real-model-pr-r.log').filter((l) => /^\[(T\d|T\d wire|sessions|executions|holders|status)\]/.test(l)).map((l) => esc(tidy(l)).replace(/(turn_complete\(end_turn\)|recoveryBlocked=false)/g, '<span class="ok">$1</span>').replace(/(\/provider\/v1\/control\[release\] -&gt; 200, \/v3\/activation -&gt; 200)/g, '<span class="warn">$1</span>'));
  const kept = log('s11-error-envelope-pr-PQRS.log').filter((l) => /code kept=/.test(l));
  const p = kept.filter((l) => /^\[P-/.test(l));
  const r = kept.filter((l) => /^\[R-/.test(l));
  const dir = path.join(SP, 'logs', 'suites-pr');
  const last = (f, re) => (fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => re.test(l)).pop() ?? '').replace(/^\[(INFO|WARNING)\]\s*/, '').replace(/ -- in .*/, '').trim();
  const suites = [
    ['runtime-broker unit', last('broker-unit.log', /Tests run: \d+, Failures/)],
    ['runtime-broker fault gates', last('fault-gates.log', /Tests run: \d+, Failures/)],
    ['runtime-broker MySQL integration (MySQL 8.4.7)', last('broker-mysql.log', /Tests run: \d+, Failures/)],
    ['managed-agent-server unit', last('server-mysql.log', /Tests run: 1\d\d, Failures/)],
    ['managed-agent-server MySQL integration + Checkstyle', `${last('server-mysql.log', /Tests run: \d+, Failures/)} · ${last('server-mysql.log', /Checkstyle violations/)}`],
    ['Hosted ITs', last('hosted-mysql.log', /Tests run: \d+, Failures/)],
    ['core managed-tool*', last('ts-core.log', /^\s*Tests\s/)],
  ];
  const flaky = ['main-1', 'pr-1', 'main-2', 'pr-2'].map((t) => {
    const [arm, round] = t.split('-');
    const one = (f) => (fs.readFileSync(path.join(SP, 'logs', `ts-flaky-${arm}-${round}-${f}.log`), 'utf8').split('\n').find((l) => /^\s*Tests\s/.test(l)) ?? '').trim().replace(/^Tests\s+/, '');
    return `${arm === 'pr' ? 'this head' : 'main     '} run ${round}   server.test.ts: ${one('server').padEnd(34)} multi-workspace-sessions.test.ts: ${one('multi-workspace-sessions')}`;
  });
  const body = `<h2>All earlier probes rerun on this head</h2><pre>round 1 · reviewer test plan, sections A–D        ${esc(sum('s1-contract-pr-ABCD.log'))}
round 1 · fault injection, sections E, F, H, I     ${esc(sum('s2-faults-pr-EFHI.log'))}      (G, worker death, is figure 3)
round 2 · error envelope, groups P, Q, R, S        ${esc(sum('s11-error-envelope-pr-PQRS.log'))}; ${p.filter((l) => /code kept=true reason kept at Broker=true/.test(l)).length} of ${p.length} refusals keep code and reason; R1 residual unchanged: ${r.filter((l) => /code kept=false/.test(l)).length} of ${r.length} long or NUL reasons lose the code
round 2 · lost control replies, enumerations K, L   ${esc(sum('s12-lost-control-pr-KL.log'))}
round 3 · receipts and repeated cancellation M1, M2 ${esc(sum('s13-merge-pr-M1M2.log'))}
round 3 · cancellation of a dispatched call M4, M5   ${esc(sum('s13-merge-pr-M4-head.log'))} and ${esc(sum('s13-merge-pr-M5-head.log'))}      (figure 6)</pre>
  <h2>Hosted Workspace loop: the PR's own driver, unchanged, on MySQL 8.4.7</h2><pre>${driver.join('\n')}</pre>
  <h2>Hosted Workspace loop: live model (qwen3.8-max), three turns</h2><pre>${model.join('\n')}</pre>
  <h2>Repository suites on this head</h2><table><tr><th style="width:45%">suite</th><th>result</th></tr>${suites.map(([n, v]) => `<tr><td class="t">${esc(n)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
  <h2>cli src/serve: two files fail differently on every run, on main too</h2><pre>${esc(flaky.join('\n'))}</pre>
  <div class="note">The cli <b>src/serve</b> run on this machine had 62 failures in 20 files while the host load average was above 50. Four files fail the same 36 tests on main (local environment, as in rounds 1 and 2). Fourteen of the other sixteen pass when rerun. The remaining two fail different tests on each run and also on main; this PR does not touch them. CI on this head is green, including <b>Test (ubuntu-latest, Node 22.x)</b>.</div>`;
  return page('Nothing else moved: regression on the merged head', 'Rounds 1 and 2 probes, the Hosted loop and the repository suites, all on the merge commit.', body);
};

cards['r3-05-mutation'] = () => {
  const all = fs.readFileSync(path.join(RIG, 'out', 'mutation', 'matrix.log'), 'utf8').split('\n');
  const lines = all.filter((l) => /^[JTNG]\d+\s/.test(l));
  const previous = new Set(JSON.parse(fs.readFileSync(path.join(SP, 'r2-archive', 'out', 'mutation', 'summary.json'), 'utf8')).survivors);
  const javaNew = (id) => id.startsWith('J') || (id.startsWith('N') && Number(id.slice(1)) <= 10) || (id.startsWith('G') && Number(id.slice(1)) <= 7);
  const killers = (id) => {
    const found = [];
    for (const kind of ['cli', 'core']) {
      const file = path.join(RIG, 'out', 'mutation', `${id}-${kind}.log.json`);
      if (!fs.existsSync(file)) continue;
      for (const t of JSON.parse(fs.readFileSync(file, 'utf8')).testResults)
        for (const a of t.assertionResults)
          if (a.status === 'failed' && !path.basename(t.name).startsWith('hosted-harness-')) found.push(`${path.basename(t.name)} › ${a.title}`);
    }
    return found;
  };
  const parsed = lines.map((l) => {
    const m = l.match(/^(\w+)\s+(KILLED|SURVIVED|INVALID|SKIPPED)\s+(.*?) :: (.*?)(?: :: (.*))?$/);
    let [, id, verdict, , what, by] = m;
    let list = by ? by.split(' | ') : [];
    if (!javaNew(id)) {
      list = killers(id);
      verdict = list.length ? 'KILLED' : 'SURVIVED';
    }
    return { id, verdict, what, killer: list[0] ? list[0] + (list.length > 1 ? ` (+${list.length - 1})` : '') : '' };
  });
  const order = (id) => ({ G: 0, J: 1, T: 2, N: 3 })[id[0]] * 1000 + Number(id.slice(1));
  const row = (p) => {
    const cls = p.verdict === 'KILLED' ? 'ok' : p.verdict === 'SURVIVED' ? 'warn' : 'dim';
    const was = p.id.startsWith('G') ? '<span class="dim">new</span>' : previous.has(p.id) ? '<span class="warn">SURVIVED</span>' : '<span class="dim">KILLED</span>';
    return `<tr><td class="dim">${p.id}</td><td>${was}</td><td class="${cls}">${p.verdict}</td><td class="t">${esc(p.what)}</td><td class="dim">${esc(p.killer.length > 96 ? `${p.killer.slice(0, 94)}…` : p.killer)}</td></tr>`;
  };
  const table = (list) => `<table><tr><th style="width:4%">id</th><th style="width:8%">round 2</th><th style="width:8%">this head</th><th style="width:36%">mutation (one edit of a production line)</th><th>first killing test</th></tr>${list.map(row).join('')}</table>`;
  const fresh = parsed.filter((p) => p.id.startsWith('G')).sort((a, b) => order(a.id) - order(b.id));
  const old = parsed.filter((p) => !p.id.startsWith('G'));
  const changed = old.filter((p) => (previous.has(p.id) ? 'SURVIVED' : 'KILLED') !== p.verdict).sort((a, b) => order(a.id) - order(b.id));
  const survivors = old.filter((p) => p.verdict === 'SURVIVED').sort((a, b) => order(a.id) - order(b.id));
  const count = (list, v) => list.filter((p) => p.verdict === v).length;
  fs.writeFileSync(path.join(RIG, 'out', 'mutation', 'summary.json'), JSON.stringify({
    total: parsed.length, killed: count(parsed, 'KILLED'), survived: count(parsed, 'SURVIVED'),
    survivors: parsed.filter((p) => p.verdict === 'SURVIVED').map((p) => p.id),
    round3: { total: fresh.length, killed: count(fresh, 'KILLED'), survived: count(fresh, 'SURVIVED') },
    earlier: { total: old.length, killed: count(old, 'KILLED'), survived: count(old, 'SURVIVED'), changedVerdict: changed.map((p) => p.id) },
  }));
  const body = `<h2>${fresh.length} new mutants of the lines written or relied on while resolving the merge</h2>${table(fresh)}
  <h2>The ${old.length} mutants of rounds 1 and 2, rerun on the merged code: survivors</h2>${table(survivors)}
  <div class="note">New mutants: ${count(fresh, 'KILLED')} of ${fresh.length} killed. Earlier mutants: ${count(old, 'KILLED')} of ${old.length} killed, ${count(old, 'SURVIVED')} survive; ${changed.length === 0 ? 'no verdict changed with the merge' : `verdicts that changed with the merge: ${changed.map((p) => p.id).join(', ')}`}. Failures in hosted-harness-session.test.ts during full runs under load are not counted as kills. G4 passes every repository test; the real-stack probes M4 and M5 tell it from this head (figure 6).</div>`;
  return page('Mutation matrix on the merged head', 'Suites: runtime-broker unit (402), managed-agent-server unit (140), cli serve managed/broker/hosted (2126), core managed-tool (190). G = merge resolution, J = Java, T = TypeScript, N = round 2.', body);
};

cards['r3-06-generation-guard'] = () => {
  const pick = (name, mode) => log(name).filter((l) => new RegExp(`^\\[M[45]-${mode}\\]|^\\[(PASS|FAIL)\\] M[45]-${mode}\\.2`).test(l)).map(paint)
    .map((l) => l.replace(/(503 runtime_execution_cancel_failed)/g, '<span class="bad">$1</span>').replace(/(worker saw \[cancel\])/g, '<span class="warn">$1</span>')).join('\n');
  const body = `<h2>This head ${HEAD} · boot v2 (boot v1 is identical)</h2><pre>${pick('s13-merge-pr-M4-head.log', 'v2')}\n${pick('s13-merge-pr-M5-head.log', 'v2')}</pre>
  <h2>Same code with mutant G4 compiled into the server jar (the test <span class="dim">getDispatchGeneration() == 0</span> removed)</h2><pre>${pick('s13-merge-g4mutant-M4M2.log', 'v2')}\n${pick('s13-merge-g4mutant-M5.log', 'v2')}</pre>
  <div class="note warn">G4 is the one new mutant that no repository test kills (402 runtime-broker tests pass with it). On the real stack it is visible. <b>M4</b>: a call that was dispatched and then cancelled is answered from its record on this head; with the mutant every repeated cancellation goes to the worker again. <b>M5</b>: a call that finished before the worker heard the cancellation is answered <b>200 success</b> on this head; with the mutant the same request is refused <b>503 runtime_execution_cancel_failed</b> every time, because the worker reports success and the prepared-cancellation path only accepts cancelled or not started. The guard is correct on this head; it has no test.</div>`;
  return page('The guard the merge wrote by hand: dispatch generation 0', 'isPreparedProviderCancellation() decides which settled calls keep asking the worker on a repeated cancellation. Two probes, two jars that differ in one class.', body);
};

cards['r3-07-main-v16'] = () => {
  const lines = log('v16-collision.log').filter(Boolean);
  const colour = (l) => esc(l).replace(/(V16__managed_session_operation\.sql V16__runtime_loss_evidence\.sql)/, '<span class="bad">$1</span>')
    .replace(/(Errors: 89)/, '<span class="bad">$1</span>').replace(/(Found more than one migration with version 16)/, '<span class="bad">$1</span>')
    .replace(/(Application run failed)/, '<span class="bad">$1</span>').replace(/(\d+\/\d+ checks passed)/g, '<span class="ok">$1</span>').replace(/(: started)/, ': <span class="ok">started</span>').replace(/(Errors: 0)/g, '<span class="ok">$1</span>').replace(/^\[(\w+)\]/, '<span class="dim">[$1]</span>');
  const part = (tag) => lines.filter((l) => l.startsWith(`[${tag}]`)).map(colour).join('\n');
  const body = `<h2>Which trees hold two migrations numbered 16</h2><pre>${part('tree')}</pre>
  <h2>main's own CI</h2><pre>${part('ci')}</pre>
  <h2>Trial merge of current main with this head, built and run here</h2><pre>${part('trial')}\n${part('start')}</pre>
  <h2>The same with #12900 (moves the later migration to V17)</h2><pre>${part('fixed')}</pre>
  <div class="note warn">Not caused by this PR and not present in its head: the head merges main as it was at 05:14Z and holds one V16. #12881 landed on main five minutes after the merge commit was made and added a second V16 beside the one from #12839. git reports no conflict because the file names differ. Every Spring context and the server jar refuse to start. Once main is merged into this branch again, or this PR is merged into main, the server and Hosted suites inherit the failure. #12900 renumbers the later migration. With it the merged tree is green, the jar starts and applies 15, 16, 17 in order, and the probes pass on the real stack: nothing else stands between this PR and current main.</div>`;
  return page('Current main carries two V16 migrations', 'Found while trial-merging this head with current main. The PR head itself is unaffected; its CI ran before #12881 landed.', body);
};

const want = process.argv[2] ? process.argv[2].split(',') : Object.keys(cards);
const browser = await chromium.launch();
const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1000 } });
for (const id of want) {
  const key = Object.keys(cards).find((k) => k.startsWith(id));
  const html = cards[key]();
  const file = path.join(OUT, `${key}.html`);
  fs.writeFileSync(file, html);
  const tab = await context.newPage();
  await tab.goto(`file://${file}`);
  const clipped = await tab.evaluate(() => [...document.querySelectorAll('pre, td')].filter((el) => el.scrollWidth > el.clientWidth + 1).length);
  await tab.locator('#card').screenshot({ path: path.join(OUT, `${key}.png`) });
  const box = await tab.locator('#card').boundingBox();
  console.log(`${key}.png ${Math.round(box.width)}x${Math.round(box.height)} clipped-elements=${clipped}`);
  await tab.close();
}
await browser.close();
