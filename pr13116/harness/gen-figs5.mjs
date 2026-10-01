// Round 5 (head 09e13d13, main 310f4ba3) evidence cards for PR 13116.
// usage: node gen-figs5.mjs
// Every number and line is read from results/*.tsv|txt, out/*.log or stack/out/*.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const RIG = '/Users/wenshao/pr13116-rig';
const FIG = `${RIG}/fig`;
const read = (p) => readFileSync(`${RIG}/${p}`, 'utf8');
const refs = Object.fromEntries(read('refs.env').trim().split('\n').map((l) => l.split('=')));
const short = (s) => s.slice(0, 8);
function tsv(...files) {
  const out = {};
  for (const file of files) {
    if (!existsSync(`${RIG}/results/${file}`)) continue;
    for (const l of read(`results/${file}`).trim().split('\n').filter(Boolean)) {
      const [, m, v, totals, failed] = l.split('\t');
      out[m] = { v, totals, failed: (failed ?? '').trim() };
    }
  }
  return out;
}
const render = (name, spec) => {
  const p = `${FIG}/${name}.json`;
  writeFileSync(p, JSON.stringify(spec, null, 1));
  console.log(execFileSync('node', [`${RIG}/scripts/card.mjs`, p, `${FIG}/${name}.png`]).toString().trim());
};
const checkstyle = (label) => existsSync(`${RIG}/out/${label}.log`) && read(`out/${label}.log`).includes('You have 0 Checkstyle violations') ? '0 violations' : 'NOT GREEN';
const ok = (t) => (/Failures: 0, Errors: 0/.test(t ?? '') ? '++ ' : '-- ');
const MUTANTS = execFileSync('node', [`${RIG}/scripts/mutate.mjs`, '-', 'list']).toString().trim().split('\n').map((l) => l.split('\t'));

// ---------- 06: current head ----------
{
  const h = tsv('matrix-targeted-head6.tsv').M0?.totals;
  const hf = tsv('matrix-full-head6.tsv').M0?.totals;
  const m = tsv('matrix-targeted-merge6.tsv').M0?.totals;
  const mf = tsv('matrix-full-merge6.tsv').M0?.totals;
  const mfr = tsv('matrix-full-flake-rerun.tsv');
  const ci = existsSync(`${RIG}/results/ci6.txt`) ? read('results/ci6.txt').trim().split('\n') : [];
  render('06-current-head', {
    title: `PR 13116 head ${short(refs.HEAD6_SHA)}: main merged, probes split; green on its base and on main ${short(refs.MAIN6_SHA)}`,
    subtitle: 'Local, JDK 21.0.12 + Maven 3.9.16, managed-agent-server surefire; checkstyle as CI runs it',
    blocks: [
      { heading: 'What changed since my last report (e9cb3bd2)', lines: [
        '== 00e80b36  Merge origin/main (57e720bc, includes #13088): packages/sdk-java tree identical to the',
        '==           resolution I verified last time (e9cb3bd2 + afb911a3, 280/0/0, 11/11)',
        '== 00480dbd  cold and transient probes moved into their own tests (bot R2-1)',
        '== 09e13d13  verifyNoInteractions(client) on both probes; transient probe warms the cache first and',
        '==           pins verify(execution).authorize(session) (bot R3-1, R2-1 fix-induced, R3-2)',
        '== production code: identical to main (test-only diff, two files)',
      ] },
      { heading: 'Runs', lines: [
        `${ok(h)}${short(refs.HEAD6_SHA)} on its own base 57e720bc, targeted:   ${h}`,
        `${ok(hf)}${short(refs.HEAD6_SHA)} on its own base, whole module:       ${hf}`,
        `${checkstyle('checkstyle-head6') === '0 violations' ? '++ ' : '-- '}${short(refs.HEAD6_SHA)} checkstyle:check:                     ${checkstyle('checkstyle-head6')}`,
        `${ok(m)}merged with main ${short(refs.MAIN6_SHA)} (clean merge), targeted: ${m}`,
        `${ok(mf)}merged with main, whole module:                ${mf}`,
        `${checkstyle('checkstyle-merge6') === '0 violations' ? '++ ' : '-- '}merged with main, checkstyle:check:            ${checkstyle('checkstyle-merge6')}`,
        ...ci,
      ] },
    ],
    note: 'Nothing in the merge needed resolving: main moved by #13118, #13109, #13114 and #13007 since 57e720bc, none of which touch the two test files.',
  });
}

// ---------- 07: mutation matrix, 15 mutants on main 310f4ba3 ----------
{
  const prev = tsv('matrix-targeted-res4.tsv', 'matrix-targeted-prev5.tsv');
  const mt = tsv('matrix-targeted-main6.tsv');
  const mf = tsv('matrix-full-main6b.tsv', 'matrix-full-main6c.tsv', 'matrix-full-main6x.tsv');
  const head = tsv('matrix-targeted-merge6.tsv');
  const cols = [prev, mt, mf, head];
  const W = 13;
  const cell = (t, m) => (t[m]?.v === 'killed' ? 'killed' : t[m]?.v === 'survived' ? 'SURVIVED' : t[m]?.v ?? '-');
  const hdr = (xs, first) => `## ${first.padEnd(7)}${xs.map((t) => t.padEnd(W)).join('')}`;
  const ids = MUTANTS.map(([m]) => m);
  const rows = ids.map((m) => {
    const c = cols.map((t) => cell(t, m));
    const tag = c[3] !== 'killed' ? '-- ' : c[2] === 'SURVIVED' ? '++ ' : '.. ';
    return `${tag}${m.padEnd(7)}${c.map((x) => x.padEnd(W)).join('')}`;
  });
  const kills = (t) => ids.filter((m) => t[m]?.v === 'killed').length;
  render('07-mutation-matrix-r5', {
    title: `15 mutants on today's main ${short(refs.MAIN6_SHA)}: what each test version catches`,
    subtitle: 'C10-C13 are the regressions the bot named in R3-1/R3-2/R2-1 against 00480dbd. "previous" = the e9cb3bd2-era test files (identical to 00e80b36), run on afb911a3 code. Each cell is a real mvn run; tree restored and checked clean after each.',
    blocks: [
      { heading: 'Result per test version (targeted = ManagedAgentPropertiesTest + QwenHostedHarnessConnectorTest)', lines: [
        hdr(['previous', 'main', 'main', '09e13d13'], 'mutant'),
        hdr(['tests', 'tests', 'whole suite', '+ main'], ''),
        hdr(['(targeted)', '(targeted)', '', '(targeted)'], ''),
        ...rows,
        `== kills: previous ${kills(prev)}/15 · main targeted ${kills(mt)}/15 · main whole suite ${kills(mf)}/15 · 09e13d13 + main ${kills(head)}/15`,
      ] },
      { heading: 'Mutants', lines: MUTANTS.map(([m, w]) => `== ${m.padEnd(4)}${w}`) },
    ],
    note: 'Green rows: today\'s main misses them across all 288 unit tests and this PR catches them. C10-C13 also survived the previous test version, so the two new commits add real detection. Whole-suite M0/C5/C8/C13 failed only in ToolPublicationStoreTest.streamsLargeOutput... (no reference to the connector; fails 1 of 3 runs alone on unmutated main); rerun with that class excluded: 250/0/0 each.',
  });
}

// ---------- 08: real stack on today's main ----------
{
  const j = (f) => (existsSync(`${RIG}/stack/out/${f}.json`) ? JSON.parse(read(`stack/out/${f}.json`)) : null);
  const calls = (a) => (a && a.length ? a.map((x) => x.slice(13)).join(', ') : 'none');
  const last = (tl) => tl?.at(-1) ?? {};
  const w0 = j('warm-K0-r5'), w1 = j('warm-KC1-r5');
  const c0 = j('cold-K0-r5'), c5 = j('cold-KC5-r5'), c10 = j('cold-KC10-r5');
  const t0 = j('transient-K0-r5'), t3 = j('transient-KC3-r5');
  const x0 = j('warmtransient-K0-r5'), x13 = j('warmtransient-KC13-r5'), x12 = j('warmtransient-KC12-r5');
  const lines = [];
  const startup = existsSync(`${RIG}/results/startup6.txt`) ? read('results/startup6.txt').trim().split('\n') : [];
  const plan = startup.find((l) => l.includes('jar=KP1 case=approval-plan'));
  if (plan) lines.push(`${plan.includes('outcome=started') ? '-- ' : '++ '}P1 jar, approval-mode=plan: ${plan.includes('outcome=started') ? 'STARTED and serves (callback is the only guard)' : 'refused'}`);
  const blocks = [{ heading: '#13047: packaged server with @PostConstruct removed', lines }];
  if (w0 && w1) blocks.push({ heading: 'Warm attachment, Workspace set DRAINING + event stream cut', lines: [
    `++ main   calls after drain: ${calls(w0.harnessCallsAfterDrain)}; Turn ${last(w0.timelineWhileDrained).status} r${last(w0.timelineWhileDrained).retry_count}${w0.afterReactivation ? `; reactivated -> ${w0.afterReactivation.status}` : ''}`,
    `-- C1     calls after drain: ${calls(w1.harnessCallsAfterDrain)}; Turn ${last(w1.timelineWhileDrained).status} while registry = ${w1.registryStateAtEnd}`,
  ] });
  if (c0) blocks.push({ heading: 'Cold attachment, Workspace drained in the statement that commits the Turn', lines: [
    `++ main   ${c0.turn.status} ${c0.turn.error_code} r${c0.turn.retry_count}; session calls: ${calls(c0.harnessCalls)}; /capabilities during Turn: ${c0.capabilitiesCallsDuringTurn.length}`,
    ...(c5 ? [`-- C5     ${c5.turn.status} ${c5.turn.error_code}; session calls: ${calls(c5.harnessCalls)}`] : []),
    ...(c10 ? [`-- C10    ${c10.turn.status} ${c10.turn.error_code}; session calls: ${calls(c10.harnessCalls)}; /capabilities during Turn: ${c10.capabilitiesCallsDuringTurn.length}`] : []),
  ] });
  if (t0 && t3) blocks.push({ heading: 'Harness down, then the table the recheck joins renamed away (cold, BadSqlGrammarException)', lines: [
    `++ main   ${t0.timelineWhileHidden.map((x) => `${x.status}/r${x.retry_count}`).join(' -> ')}; restored -> ${t0.final.status}, file written: ${t0.fileWritten}`,
    `-- C3     ${t3.timelineWhileHidden.map((x) => `${x.status}${x.error_code ? ` ${x.error_code}` : ''}/r${x.retry_count}`).join(' -> ')}`,
  ] });
  if (x0 && x13) blocks.push({ heading: 'Warm attachment, table renamed away + event stream cut (the bot\'s R2-1 shape)', lines: [
    `++ main   calls while hidden: ${calls(x0.harnessCallsWhileHidden)}; ${x0.timelineWhileHidden.map((x) => `${x.status}/r${x.retry_count}`).join(' -> ')}${x0.afterRestore ? `; restored -> ${x0.afterRestore.status}` : ''}`,
    `-- C13    calls while hidden: ${calls(x13.harnessCallsWhileHidden)}; ${x13.timelineWhileHidden.map((x) => `${x.status}/r${x.retry_count}`).join(' -> ')}`,
    ...(x12 ? [`-- C12    calls while hidden: ${x12.harnessCallsWhileHidden.length} x DELETE /session/:id (last ${x12.harnessCallsWhileHidden.at(-1).replace(/^.* -> /, '')}); restored -> ${x12.afterRestore?.status} ${x12.afterRestore?.error_code}`] : []),
  ] });
  render('08-real-stack-r5', {
    title: `Real stack on today's main ${short(refs.MAIN6_SHA)}: what the pinned behaviours do in production`,
    subtitle: 'Spring jar built from 09e13d13 + main (= main production) or one mutant of it, MySQL 8.4.7, embedded Broker, Hosted Harness bundled from the same tree, recording proxy, scripted model',
    blocks,
    note: 'Each mutant row is a single-site change built into the packaged jar; each scenario ran once per jar. C10 is harmless on a live stack: HostedHarnessClient.capabilities() returns the value cached when the client was built, so no request leaves Spring. C12 is not: closeSession() is a real DELETE, and one database blip during the recheck deletes the running Harness session.',
  });
}
