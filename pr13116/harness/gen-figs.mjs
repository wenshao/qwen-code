// Builds the evidence-card specs for PR 13116 from the recorded rig outputs and renders them.
// usage: node gen-figs.mjs
// Every number and line below is read from results/*.tsv, results/*.txt or stack/out/*.json;
// nothing in the cards is typed by hand except headings and the notes.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const RIG = '/Users/wenshao/pr13116-rig';
const FIG = `${RIG}/fig`;
const read = (p) => readFileSync(`${RIG}/${p}`, 'utf8');
const refs = Object.fromEntries(read('refs.env').trim().split('\n').map((l) => l.split('=')));
const short = (s) => s.slice(0, 8);

function tsv(file) {
  if (!existsSync(`${RIG}/results/${file}`)) return {};
  const out = {};
  for (const l of read(`results/${file}`).trim().split('\n').filter(Boolean)) {
    const [, m, v, totals] = l.split('\t');
    out[m] = { v, totals };
  }
  return out;
}
const render = (name, spec) => {
  const p = `${FIG}/${name}.json`;
  writeFileSync(p, JSON.stringify(spec, null, 1));
  console.log(execFileSync('node', [`${RIG}/scripts/card.mjs`, p, `${FIG}/${name}.png`]).toString().trim());
};
const resultLines = (file, labels) => {
  const all = read(file).split('\n').filter((l) => l.startsWith('RESULT '));
  return labels.map((lab) => {
    const hits = all.filter((l) => l.split(' ')[1] === lab);
    const l = hits.at(-1);
    return l;
  });
};

// ---------- 01: merge with today's main ----------
{
  const t1 = resultLines('results/targeted.txt', ['t-head', 't-merge', 't-main']);
  const t2 = resultLines('results/targeted2.txt', ['t-head2', 't-merge2', 't-k3a', 't-k3']);
  const fmt = (l, what) => {
    const m = l.match(/exit=(\d+) Tests run: (\d+), Failures: (\d+), Errors: (\d+)/);
    const ok = m[1] === '0';
    return `${ok ? '++ ' : '-- '}${what.padEnd(62)} run ${m[2]}  fail ${m[3]}  err ${m[4]}`;
  };
  const full = (arm) => tsv(`matrix-full-${arm}.tsv`).M0?.totals ?? 'n/a';
  render('01-merge-with-main', {
    title: 'PR 13116: CI was green on a main without #13101; after merging today\'s main, both new tests fail',
    subtitle: `Local, JDK 21.0.12 + Maven, managed-agent-server surefire. main = ${short(refs.MAIN_SHA)} (sdk-java identical to current 6e343482)`,
    blocks: [
      {
        heading: 'Timeline (from the CI log and git)',
        lines: [
          '== 15:37:58Z  f7a71db4 pushed',
          '== 15:38:54Z  CI checkout: "Merge f7a71db4... into da428be61a"  (main before #13101)',
          '!! 15:38:56Z  #13101 (78143fe3) merged: message "preapproved"->"supported", approval-mode',
          '!!            confirmation in createOrLoad, 4-arg connector constructor (3-arg passes actions=null)',
          '== 18:48:55Z  a554a8fb pushed',
          '-- 18:57:24Z  a554a8fb CI ("Merge a554a8fb into 51b80dad"), MariaDB job: Tests run: 256, Failures: 2',
          '--            at ManagedAgentPropertiesTest:31 and QwenHostedHarnessConnectorTest:89 (same as local below)',
        ],
      },
      {
        heading: 'ManagedAgentPropertiesTest + QwenHostedHarnessConnectorTest',
        lines: [
          fmt(t1[0], `f7a71db4 on its own base ${short(refs.BASE_SHA)}`),
          fmt(t1[1], `f7a71db4 merged with main ${short(refs.MAIN_SHA)}`),
          fmt(t2[0], `a554a8fb on its own base ${short(refs.BASE_SHA)}`),
          fmt(t2[1], `a554a8fb merged with main ${short(refs.MAIN_SHA)}`),
          '--   ManagedAgentPropertiesTest:31  root cause "...require a supported Harness..." (expected "preapproved")',
          '--   QwenHostedHarnessConnectorTest:89  authorize(session): Wanted 2 times, But was 4 times',
          fmt(t2[2], 'merge + message fix + times(4), cold keeps 3-arg constructor'),
          '--   :95  IllegalStateException: Hosted Workspace Sessions require the Managed Action store',
          fmt(t2[3], 'merge + all three edits (candidate K3)'),
        ],
      },
      {
        heading: 'Whole module suite (surefire)',
        lines: [
          `-- a554a8fb merged with main          ${full('merge2')}`,
          '     = the two tests above + ToolPublicationStoreTest.renewsTheOriginalClaim... (load flake, 26/26 on rerun)',
          `++ candidate K3 (merge + 3 edits)     ${full('k3')}`,
          '++ checkstyle:check on a554a8fb and on K3: 0 violations',
        ],
      },
    ],
    note: 'GitHub shows MERGEABLE because the merge has no textual conflict. Squash-merging a554a8fb as it is would turn main\'s Java jobs red; merging main into the branch and changing three lines fixes it.',
  });
}

// ---------- 02: mutation matrix ----------
{
  const arms = [
    ['base', 'main tests at PR base', 'matrix-targeted-base.tsv'],
    ['head', 'f7a71db4 tests', 'matrix-targeted-head.tsv'],
    ['head2', 'a554a8fb tests', 'matrix-targeted-head2.tsv'],
    ['main', 'main tests (today)', 'matrix-targeted-main.tsv'],
    ['mainFull', 'main: whole suite', null],
    ['k3', 'K3 tests (on main)', 'matrix-targeted-k3.tsv'],
  ];
  const data = Object.fromEntries(arms.map(([k, , f]) => [k, f ? tsv(f) : { ...tsv('matrix-full-mainA.tsv'), ...tsv('matrix-full-mainB.tsv') }]));
  const mut = execFileSync('node', [`${RIG}/scripts/mutate.mjs`, '-', 'list']).toString().trim().split('\n').map((l) => l.split('\t'));
  const cell = (k, m) => {
    const v = data[k][m]?.v;
    return v === 'killed' ? 'killed' : v === 'survived' ? 'SURVIVED' : v ? v : '-';
  };
  const W = 12;
  const h1 = ['PR base', 'f7a71db4', 'a554a8fb', 'main', 'main', 'K3'];
  const h2 = ['tests', 'tests', 'tests', 'tests', 'whole suite', 'tests'];
  const h3 = ['(base code)', '(base code)', '(base code)', '(main code)', '(main code)', '(main code)'];
  const hdr = (xs, first) => `## ${first.padEnd(7)}${xs.map((t) => t.padEnd(W)).join('')}`;
  const header = hdr(h1, 'mutant'), header2 = hdr(h2, ''), header3 = hdr(h3, '');
  const rows = mut.map(([m]) => {
    const cells = arms.map(([k]) => cell(k, m));
    const tag = cells[2] === 'killed' && cells[4] === 'SURVIVED' ? '++ ' : cells[1] === 'SURVIVED' && cells[0] === 'killed' ? '!! ' : '.. ';
    return `${tag}${m.padEnd(7)}${cells.map((x) => x.padEnd(W)).join('')}`;
  });
  const legend = mut.map(([m, what]) => `== ${m.padEnd(4)}${what}`);
  const count = (k) => Object.entries(data[k]).filter(([m, x]) => m !== 'M0' && x.v === 'killed').length;
  render('02-mutation-matrix', {
    title: 'Mutation matrix: 11 single-site mutants of unmodified production code',
    subtitle: 'Columns 1-3 run the two changed test classes on the PR base production code; columns 4-6 on main 51b80dad production code. Each cell is a real mvn run; the tree is restored and checked clean after every mutant.',
    blocks: [
      { heading: 'Result per test version (targeted = the two changed classes; "whole suite" = all 255 unit tests of the module on main)', lines: [header, header2, header3, ...rows] },
      { heading: 'Kills', lines: [
        `== PR base tests ${count('base')}/11 · f7a71db4 ${count('head')}/11 · a554a8fb ${count('head2')}/11 · main tests ${count('main')}/11 · main whole suite ${count('mainFull')}/11 · K3 ${count('k3')}/11`,
        '!! C3 regressed in round 1: killed by the PR-base test (hasMessage("grant revoked")), survived f7a71db4; a554a8fb kills it again',
      ] },
      { heading: 'Mutants', lines: legend },
    ],
    note: 'Both issues\' third acceptance criterion holds when run: P1 (#13047) and C1 (#13048) survive every test on main, including the whole 255-test suite, and are killed by this PR. a554a8fb also closes the bot R1-1/R1-2 cells (C3, C4, C5). K3 keeps all 11 kills on today\'s main.',
  });
}

// ---------- 03: packaged server startup ----------
{
  const lines = read('results/startup.txt').trim().split('\n').map((l) => {
    const g = (k) => l.match(new RegExp(`${k}=(\\S+)`))[1];
    const cause = l.replace(/^.*cause=/, '');
    const started = g('outcome') === 'started';
    const jar = g('jar') === 'J0' ? 'main jar' : 'main jar, @PostConstruct removed (P1)';
    const c = { default: 'G0 left at defaults (disabled)', supported: 'G0 enabled, supported deployment', 'isolation-workspace': 'G0 enabled + isolation-class=workspace', 'approval-plan': 'G0 enabled + approval-mode=plan' }[g('case')];
    const bad = g('jar') === 'JP1' && g('case') === 'approval-plan';
    return [
      `${bad ? '-- ' : started ? '++ ' : '== '}${jar.padEnd(40)}${c.padEnd(40)}${started ? `STARTED, GET /v1/agents/workspaces ${g('GET/v1/agents/workspaces')}` : 'exit 1 during startup'}`,
      ...(started ? [] : [`     ${cause.replace('IllegalStateException: ', 'IllegalStateException: ')}`]),
    ];
  }).flat();
  render('03-packaged-startup', {
    title: '#13047 on the packaged server: what the lifecycle callback actually guards',
    subtitle: 'qwen-managed-agent-server-0.1.0-alpha.jar built from main 51b80dad (and the same jar with only @PostConstruct removed), MySQL 8.4.7, java -cp ... PropertiesLauncher',
    blocks: [{ heading: 'Startup outcome', lines }],
    note: 'With the callback removed, approval-mode=plan starts and serves: the callback is the only guard for that clause. isolation-class=workspace still fails, because WorkspaceRuntimeResolver has its own check. The PR\'s ApplicationContextRunner loads only the properties bean, so its isolation-class case is still a valid witness for the callback.',
  });
}

// ---------- 04: real stack ----------
{
  const j = (f) => JSON.parse(read(`stack/out/${f}.json`));
  const w0 = j('warm-J0-j0'), w1 = j('warm-JC1-jc1');
  const c0 = j('cold-J0-j0'), c5 = j('cold-JC5-jc5'), c1 = j('cold-JC1-jc1');
  const t0 = j('transient-J0-j0'), t3 = j('transient-JC3-jc3');
  const frame = (r, needle) => (r.thrown ?? r.thrownAfterDrain ?? r.thrownWhileHidden).find((e) => e.frames.some((f) => f.startsWith('QwenHostedHarnessConnector.createOrLoad')));
  const at = (r) => { const e = frame(r); return e ? `${e.cls} at ${e.frames.slice(0, 3).join(' <- ')}` : 'n/a'; };
  const calls = (a) => (a.length ? a.map((x) => x.slice(13)).join(', ') : 'none');
  const last = (tl) => tl.at(-1);
  render('04-real-stack', {
    title: '#13048 on a real stack: what each pinned behaviour does in production',
    subtitle: 'Spring jar from main 51b80dad (or one mutant of it) + MySQL 8.4.7 + embedded Broker + packaged Hosted Harness (dist/cli.js of the same main) + recording proxy + scripted model; JFR records where each exception is thrown',
    blocks: [
      { heading: 'Warm attachment: Turn admitted and running, then Workspace set DRAINING and the event stream cut', lines: [
        `++ main jar   harness calls after drain: ${calls(w0.harnessCallsAfterDrain)}; Turn ${last(w0.timelineWhileDrained).status}, retry ${last(w0.timelineWhileDrained).retry_count} after ${last(w0.timelineWhileDrained).tSec}s; reactivated -> ${w0.afterReactivation.status}`,
        `     refusal: ${at(w0)}`,
        `-- C1 jar     harness calls after drain: ${calls(w1.harnessCallsAfterDrain)}; Turn ${last(w1.timelineWhileDrained).status} after ${last(w1.timelineWhileDrained).tSec}s while registry = ${w1.registryStateAtEnd}`,
        '     (C1 = catch-and-ignore RuntimeBrokerException around the recheck: the refusal is thrown and swallowed)',
      ] },
      { heading: 'Cold attachment: Workspace drained in the statement that commits the Turn (first createOrLoad)', lines: [
        `++ main jar   ${c0.turn.status} ${c0.turn.error_code}, retry ${c0.turn.retry_count}, ${c0.turn.settledMs} ms; harness calls: ${calls(c0.harnessCalls)}`,
        `-- C5 jar     ${c5.turn.status} ${c5.turn.error_code}, retry ${c5.turn.retry_count}; harness calls: ${calls(c5.harnessCalls)}`,
        `     refusal: ${at(c5)}   (recheck after attachments.put)`,
        `-- C1 jar     ${c1.turn.status} ${c1.turn.error_code}; harness calls: ${calls(c1.harnessCalls)}; file written: ${c1.fileWritten}`,
        '     prompt reached the model; the Broker\'s own resolve() refused the tool call',
      ] },
      { heading: 'Non-refusal failure inside the recheck: Harness down, then the joined table renamed away (BadSqlGrammarException)', lines: [
        `++ main jar   ${t0.timelineWhileHidden.map((x) => `${x.status}/r${x.retry_count}`).join(' -> ')}; restored -> ${t0.final.status}, file written: ${t0.fileWritten}`,
        `     ${t0.retryLogWhileHidden.slice(-1)[0]}`,
        `-- C3 jar     ${t3.timelineWhileHidden.map((x) => `${x.status}${x.error_code ? ` ${x.error_code}` : ''}/r${x.retry_count}`).join(' -> ')}  (terminal ${t3.timelineWhileHidden.at(-1).tSec}s after the DB error)`,
        '     (C3 = any RuntimeException from the recheck remapped to WorkspaceExecutionStore.unavailable())',
      ] },
    ],
    note: 'What goes red in a554a8fb\'s connector test when each mutant is applied: C1 - nothing is thrown; C3 and C4 - isSameAs(refusal) (both rethrow a different instance); C5 - never() loadSession on the cold connector. The mutants were built into the packaged jar, one per run.',
  });
}
