// Build the evidence cards from out/runs + out/mutants.tsv and render PNGs.
// usage: node build.mjs <fig...>   figs: 1 2 3 4
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { card, table } from './card.mjs';
import { timeline } from './timeline.mjs';

const RIG = '/Users/wenshao/pr13366-rig';
const FIG = `${RIG}/fig`;
const SHA = { base: '8a1a2efe27', head: '0dccd187d7', merge: '886eb4b9f2 (head + main 35616f3b64)' };
const runs = readdirSync(`${RIG}/out/runs`).sort();
const res = (run) => JSON.parse(readFileSync(`${RIG}/out/runs/${run}/result.json`, 'utf8').trim().split('\n').at(-1));
const tap = (run) => readFileSync(`${RIG}/out/runs/${run}/broker-tap.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const busyOf = (run) => tap(run).filter((e) => e.p.endsWith('tool-sessions:acquire') && e.s === 409 && e.code === 'workspace_busy').length;
const relOf = (run) => tap(run).filter((e) => e.p.endsWith(':release') && e.s === 200).length;
const code = (t) => (JSON.parse(t?.data ?? 'null') ?? {}).code;
const termOf = (r, l) => r.timeline.find((e) => e.what === 'terminal' && e.label === l);
const range = (xs) => (Math.min(...xs) === Math.max(...xs) ? `${xs[0]}` : `${Math.min(...xs)}–${Math.max(...xs)}`);
const render = (n, name, html) => {
  writeFileSync(`${FIG}/${name}.html`, html);
  execFileSync('node', [`${FIG}/render.mjs`, `${FIG}/${name}.html`, `${FIG}/${name}.png`], { stdio: 'inherit' });
};
const STACK =
  'Arms: base 8a1a2efe27 (PR parent) · head 0dccd187d7 · merge = head merged onto main 35616f3b64 (identical to landed main bf3ab0723f in serve/, sdk-java/, core managed-runtime/). Real stack per run: Spring Managed Agent Server jar (embedded Runtime Broker) + private mysqld + `dist/cli.js serve --profile hosted-harness`, deterministic fake OpenAI model; two Workspace-bound Sessions bound to one mount.';

// Expected per-Session outcome on head/merge (base: the #13328 loss is the expected bug shape).
const EXPECT = {
  core: (o) => Object.values(o).every((v) => v === 'completed'),
  three: (o) => Object.values(o).every((v) => v === 'completed'),
  long: (o) => Object.values(o).every((v) => v === 'completed'),
  cancelq: (o) => o.A === 'completed' && o.B === 'cancelled' && o.B2 === 'completed',
  cancelqe: (o) => o.A === 'completed' && o.B === 'cancelled' && o.B2 === 'completed',
  deadline: (o) => o.A === 'failed/hosted_turn_deadline_exceeded' && o.B === 'failed/hosted_turn_deadline_exceeded' && o.B2 === 'completed',
  holdercancel: (o) => o.A === 'cancelled' && o.B === 'completed',
  holderfail: (o) => o.A === 'failed/hosted_turn_failed' && o.B === 'completed',
};
function scenarioRows(prefix, arms) {
  return arms.map((arm) => {
    const rs = runs.filter((r) => r.startsWith(`${prefix}-${arm}-`) && existsSync(`${RIG}/out/runs/${r}/result.json`));
    const results = rs.map(res);
    const outcome = (r) => Object.fromEntries(Object.keys(r.terminals).map((l) => [l, `${(r.terminals[l].type ?? 'none').replace('turn.', '')}${code(termOf(r, l)) ? '/' + code(termOf(r, l)) : ''}`]));
    const shapes = results.map((r) => { const o = outcome(r); return Object.keys(o).sort().map((l) => `${l} ${o[l]}`).join(' · '); });
    const shapeSummary = [...new Set(shapes)].map((x) => `${shapes.filter((y) => y === x).length}× ${x}`).join('  |  ');
    const ok = results.filter((r) => EXPECT[prefix](outcome(r))).length;
    const verdict = arm === 'base' ? (ok === 0 ? '✖ loses a Turn (bug)' : `~ ${ok}/${results.length}`) : ok === results.length ? `✔ ${ok}/${results.length}` : `✖ ${ok}/${results.length}`;
    return [
      arm,
      String(results.length),
      verdict,
      shapeSummary.replaceAll('completed', '✓').replaceAll('failed/hosted_turn_deadline_exceeded', 'deadline_exceeded').replaceAll('failed/hosted_turn_failed', 'hosted_turn_failed'),
      range(rs.map(busyOf)),
      range(results.map((r) => r.queueNotices)),
      range(results.map((r) => new Set(r.timeline.filter((e) => e.what === 'lease' && !e.row.startsWith('-')).map((e) => e.row.split(' ')[0])).size)),
      [...new Set(results.map((r) => r.toolExecutions.join(',')))].join(' / '),
      results.some((r) => r.crossTalk) ? '✖ yes' : 'none',
    ];
  });
}
const SCN_HEAD = ['arm', 'runs', 'expected outcome', 'per-Session terminal (✓ = completed)', '409 busy / run', 'notices / run', 'lease holders', 'tool rows', 'cross-talk'];

const figs = process.argv.slice(2);
if (figs.includes('1')) {
  const issueRuns = runs.filter((r) => r.startsWith('issue-'));
  const issueRows = ['base', 'head', 'merge'].map((arm) => {
    const logs = issueRuns.filter((r) => r.startsWith(`issue-${arm}-`)).map((r) => readFileSync(`${RIG}/out/runs/${r}/run.log`, 'utf8'));
    const verdicts = logs.map((l) => (/"reproduced": true/.test(l) ? 'reproduced: true (completed 1, failed 1)' : /Both concurrent Workspace Sessions completed/.test(l) ? 'throws "Both concurrent Workspace Sessions completed … re-record this mode"' : 'other'));
    return [`${arm} ${SHA[arm].split(' ')[0]}`, String(logs.length), [...new Set(verdicts)].map((v) => `${verdicts.filter((x) => x === v).length}× ${v}`).join('; ')];
  });
  render(1, '01-issue-scenario-ab', card({
    title: '#13328 scenario on the real stack — base loses one Turn, the PR queues it',
    sub: STACK,
    blocks: [
      { h: `base ${SHA.base}: the loser is refused once and settles turn.failed (hosted_turn_failed)`, cap: 'core-base-1 — prompts admitted 202 back-to-back; one acquisition gets 409 workspace_busy from the Broker and the Turn ends.', svg: timeline('core-base-1').svg },
      { h: `PR head ${SHA.head}: the loser polls the real Broker, acquires after the holder's :release, completes`, cap: 'core-head-1 — the lease row passes holder → empty → second holder; both tools execute once.', svg: timeline('core-head-1').svg },
      { h: 'Same scenario ×5 per arm', table: table(SCN_HEAD, scenarioRows('core', ['base', 'head', 'merge'])) },
      { h: "The issue's own runner (--second-workspace-session, uncommitted in qwen-code-x5) ×2 per arm", table: table(['arm', 'runs', 'runner verdict'], issueRows) },
      { note: 'Claim holds on the real Java Broker + lease row: base 5/5 lose a Turn; head 5/5 and merge 5/5 complete both Turns, each tool executes exactly once (SETTLED:2), the stderr notice appears once per queued Turn, no cross-Session text. The runner flips to its own “re-record this mode” sentinel exactly as the PR predicts.' },
    ],
  }));
}
if (figs.includes('2')) {
  const pick = (p) => runs.find((r) => r.startsWith(p) && existsSync(`${RIG}/out/runs/${r}/result.json`));
  const blocks = [];
  const add = (run, h, cap) => run && blocks.push({ h, cap, svg: timeline(run).svg });
  add(pick('long-merge-'), 'Long queue: holder keeps the mount 30 s (post-tool model reply held)', `${pick('long-merge-')} — waiter polls every ~264 ms against the real Broker, one stderr notice, acquires 0.1 s after :release and completes.`);
  add(pick('cancelqe-merge-'), 'Cancel the queued Turn at 12 s, then immediately send a follow-up to the same Session', `${pick('cancelqe-merge-')} — public agent.session.cancel → the queued Turn settles cancelled in ~0.3 s and issues no :release (it never held); follow-up B2, sent ~12 ms later, queues again behind A and completes.`);
  add(pick('deadline-merge-'), 'Deadline fires while queued (merge, QWEN_MANAGED_AGENT_HARNESS_TURN_DEADLINE=20s)', `${pick('deadline-merge-')} — B queues behind A; B's deadline fires mid-queue; A (held 60 s) hits its own deadline and releases; follow-up B2 completes.`);
  add(pick('holdercancel-merge-'), 'Holder cancelled at 10 s while the waiter is queued', `${pick('holdercancel-merge-')} — A cancelled mid-hold releases the mount; B acquires right after instead of waiting for the 40 s hold.`);
  add(pick('holderfail-merge-'), 'Holder Turn fails after its tool (provider error on the post-tool reply)', `${pick('holderfail-merge-')} — A fails, the mount is released, queued B completes.`);
  render(2, '02-queue-edges', card({ title: 'Queue edges on the real stack (merge arm shown; head identical — see table)', sub: STACK, blocks }));
}
if (figs.includes('3')) {
  const rows = [];
  for (const [prefix, desc, arms] of [
    ['core', 'issue shape: 2 Sessions, back-to-back', ['base', 'head', 'merge']],
    ['three', '3 Sessions, back-to-back', ['base', 'head', 'merge']],
    ['long', 'holder keeps mount 30 s', ['base', 'head', 'merge']],
    ['cancelq', 'cancel queued Turn @12 s; follow-up after A ends', ['head', 'merge']],
    ['cancelqe', 'cancel queued Turn @12 s; immediate follow-up queues', ['head', 'merge']],
    ['deadline', 'deadline 20 s fires while queued + follow-up', ['merge']],
    ['holdercancel', 'holder cancelled @10 s (hold 40 s)', ['head', 'merge']],
    ['holderfail', 'holder Turn fails after its tool', ['head', 'merge']],
  ]) {
    if (!runs.some((r) => r.startsWith(`${prefix}-`))) continue;
    for (const row of scenarioRows(prefix, arms.filter((a) => runs.some((r) => r.startsWith(`${prefix}-${a}-`))))) rows.push([desc, ...row]);
  }
  render(3, '03-run-matrix', card({ title: 'All real-stack runs', sub: STACK, blocks: [{ table: table(['scenario', ...SCN_HEAD], rows) }] , width: 1700}));
}
if (figs.includes('4')) {
  const mut = readFileSync(`${RIG}/out/mutants.tsv`, 'utf8').trim().split('\n').map((l) => l.split('\t'));
  render(4, '04-mutants', card({
    title: 'Mutation check — do the PR’s own suites pin the change?',
    sub: 'hosted-workspace-tool-turn.test.ts + hosted-harness-session.issue-13328.test.ts on head (147 tests). Each mutant is one anchored edit of hosted-workspace-tool-turn.ts; killed = red on two consecutive runs.',
    blocks: [{ table: table(['id', 'verdict', 'mutant', 'vitest', 'first failing tests'], mut.map((m) => [m[0], m[0] === 'M0' ? 'PASS (baseline)' : m[1], m[2], m[3] ?? '', (m[4] ?? '').slice(0, 150)])) }],
  }));
}
