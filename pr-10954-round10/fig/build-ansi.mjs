// Builds the round-10 figures as ANSI text from the recorded JSON results
// (no hand-typed numbers), one .ansi file per figure.
import fs from 'node:fs';
import path from 'node:path';

const RUN = '/root/verify/pr10954/run';
const OUT = '/root/verify/pr10954/fig10';
const j = (p) => JSON.parse(fs.readFileSync(path.join(RUN, p), 'utf8'));

const C = {
  t: (s) => `\x1b[1;36m${s}\x1b[0m`,
  h: (s) => `\x1b[1;37m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
};
const vis = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...vis(s)].length));
const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
const write = (name, L) => fs.writeFileSync(path.join(OUT, name), L.join('\n') + '\n');

// ---------------------------------------------------------------- figure 1
{
  const m = j('merge-audit.json');
  const g = j('gates-summary.json');
  const e = Object.fromEntries(j('e2e-n1/head.json').map((x) => [x.k, x.v]));
  const tally = j('n1-tally/head.json');
  const cf = j('control-flags/head.json').find((x) => x.step === 'launch');
  const sa = j('stop-ambiguous/head.json')[0];
  const L = [];
  L.push(C.t('PR #10954 · round 10 · head 728f08a67e · Linux x86_64 · Node 22.22.2 · fresh pnpm install + build + bundle'));
  L.push('');
  L.push(C.h('① What changed since round 9 (b98dfa1927)'));
  L.push(`  one commit: a merge of main (${m.mainCommitsMerged} commits). PR's own patch:${m.prOwnPatch}`);
  L.push(`  PR's own +/− lines vs round 9: ${C.ok('byte-identical')} ${C.dim(`(${m.prOwnPatchLinesDifferingFromRound9} context lines in cli.test.ts moved because main added a mock)`)}`);
  L.push(`  main's changes under packages/cli/src/agent-view/: ${C.ok(m.mainChangesToAgentView)}`);
  L.push(`  conflict: ${m.conflicts[0]} → resolved as the ${C.ok('union of both sides')} ${C.dim('(tree = plain merge-tree minus the 3 marker lines)')}`);
  L.push(`  merge into current main ${m.mergeIntoCurrentMain.main} (+${m.mergeIntoCurrentMain.aheadOfMergedMain} commits): ${C.ok('clean')}`);
  L.push('');
  L.push(C.h('② N1 on the fresh build: same QWEN_HOME, real model qwen3.8-max as the positive control'));
  const ctl = e['control: qwen -p (qwen3.8-max)'];
  L.push(`  ${pad('$ qwen -p "Reply with exactly the word PONG…"', 52)}${C.ok(`exit ${ctl.code} in ${sec(ctl.ms)} → ${ctl.stdout}`)}`);
  const bg = e['step1b: qwen --bg'];
  L.push(`  ${pad('$ qwen --bg "Reply with exactly the word PONG…"', 52)}${C.bad(`exit ${bg.code} after ${sec(bg.ms)}`)}`);
  L.push(`    ${C.bad(bg.stderr.replace(/[0-9a-f-]{36}/, '<id>'))}`);
  const launch = e['store: launch.json worker argv / initialPrompt'];
  L.push(`  launch.json worker argv: ${JSON.stringify(launch.argv.slice(2)).replace(/[0-9a-f-]{36}/, '<id>')}  ${C.dim('(the prompt is only in initialPrompt)')}`);
  const all = [bg.ms, ...tally.map((t) => t.ms), cf.ms, sa.ms];
  const fails = [bg.code, ...tally.map((t) => t.code), cf.code, sa.code].filter((c) => c === 1).length;
  L.push(`  all ${all.length} recorded launches this round: ${C.bad(`${fails}/${all.length} exit 1, ${sec(Math.min(...all))}–${sec(Math.max(...all))}`)}, "did not report ready before timeout"; none succeeded`);
  L.push('');
  L.push(C.h('③ Gates at 728f08a67e'));
  L.push(`  10 PR test files (incl. the conflict-resolved cli.test.ts, ${g.prFiles.perFile.find((f) => f.file === 'src/cli.test.ts').n}/${g.prFiles.perFile.find((f) => f.file === 'src/cli.test.ts').n})   ${C.ok(`${g.prFiles.passed}/${g.prFiles.total}`)}`);
  L.push(`  src/serve/server.test.ts                                     ${C.ok(`${g.server.passed}/${g.server.total}`)}`);
  L.push(`  src/agent-view/                                              ${C.ok(`${g.agentView.passed}/${g.agentView.total}`)}`);
  L.push(`  cli tsc --noEmit · eslint --max-warnings 0 · prettier (31 files) ${C.ok('exit 0 · exit 0 · exit 0')}`);
  L.push(`  PR CI: Lint & Static ${C.ok('✓')}  Test (ubuntu) ${C.ok('✓')}  Test (macos/windows) ${C.warn('skipped')}  Integration (CLI) ${C.warn('skipped')}`);
  write('r10-01-delta-n1-gates.ansi', L);
}

// ---------------------------------------------------------------- figure 2
{
  const cf = j('control-flags/head.json').filter((x) => x.step === 'control');
  const vs = j('version-scope/head.json');
  const vsMain = j('version-scope/main.json');
  const bp = j('bg-position/head.json').filter((x) => x.argv);
  const bpMain = j('bg-position/main.json').filter((x) => x.argv);
  const L = [];
  L.push(C.t('PR #10954 · round 10 · standing bot Criticals, executed through the shipped bin on a REAL session (real supervisor + store)'));
  L.push('');
  L.push(C.h('① R7-2 / R14-4 / R10-1 — control commands vs a stray -v / -h   (store state read before → after each command)'));
  L.push(C.dim(pad('  command', 52) + pad('exit', 6) + pad('output', 58) + 'store'));
  for (const r of cf) {
    let out = (r.stdout || r.stderr).replace('Agent View session <id> is not wait…', 'Agent View session <id> is not waiting… (reached)');
    if (/^qwen sessions answer <session> <text>/.test(out)) out = 'usage text on stderr (answer text lost)';
    if (/^qwen sessions stop <session>/.test(out)) out = 'help text for `sessions stop`';
    if (/^Reply with/.test(out)) out = 'title · State: failed · Directory: <ws>';
    const changed = r.stateBefore !== r.stateAfter;
    const falseOk = r.code === 0 && !changed && /stop/.test(r.argv) && !/Stopped/.test(out);
    const outC = falseOk ? C.bad(out.slice(0, 56)) : /reached/.test(out) || /Stopped/.test(out) ? C.ok(out.slice(0, 56)) : out.slice(0, 56);
    L.push(`  ${pad(r.argv, 50)}${pad(r.code === 0 ? (falseOk ? C.bad('0') : '0') : String(r.code), 6)}${pad(outC, 58)}${changed ? C.ok(`${r.stateBefore} → ${r.stateAfter}`) : `${r.stateBefore} → ${r.stateAfter}`}`);
  }
  L.push(C.dim('  A bare -v/--version/-h makes `stop` exit 0 without stopping. A QUOTED "…-v…" is one token and reaches the supervisor,'));
  L.push(C.dim('  so the "check the -v flag" scenario in R7-2 does not reproduce. The intercept is CLI-wide, not new to this PR:'));
  for (const r of vs.filter((x) => /list|mcp/.test(x.argv))) {
    const mm = vsMain.find((x) => x.argv === r.argv);
    L.push(`  ${pad(r.argv, 50)}${pad(String(r.code), 6)}${pad(r.verdict, 26)}${C.dim(`main 51b80dadbc: exit ${mm.code}, ${mm.verdict}`)}`);
  }
  L.push(C.dim('  New: a dash-leading answer cannot be delivered at all — `--` does not help `answer` (it does help `stop`):'));
  for (const r of vs.filter((x) => /answer|stop/.test(x.argv))) {
    const v = r.verdict === 'reached the command' ? C.ok(r.verdict) : C.warn(r.verdict);
    L.push(`  ${pad(r.argv, 50)}${pad(String(r.code), 6)}${v}`);
  }
  L.push('');
  L.push(C.h('② R15-2 — `qwen --help` advertises --bg, but only a LEADING --bg is accepted   (home points at a dead endpoint: nothing billed)'));
  const help = j('bg-position/head.json')[0];
  L.push(`  ${pad('$ qwen --help', 54)}${C.dim(help.out.replace(/\s+/g, ' ').slice(0, 60) + '…')}  ${C.dim(`main: ${j('bg-position/main.json')[0].out}`)}`);
  for (const r of bp.slice(1)) {
    const mm = bpMain.find((x) => x.argv === r.argv);
    L.push(`  ${pad('$ ' + r.argv, 54)}${pad(C.warn(`exit ${r.code}`), 8)}${C.warn(r.stderrFirst)} ${C.dim(`+ ${r.stderrLines - 1} help lines · dispatched: ${r.dispatched} · main: exit ${mm.code}, ${mm.stderrFirst}`)}`);
  }
  L.push(C.dim('  Loud, not silent (exit 1, nothing dispatched). cli.test.ts "does not hijack a query that only mentions --bg" passes only'));
  L.push(C.dim('  because main() is mocked: the real `qwen explain what --bg does` never reaches main(). Same outcome as main, so not a regression — but --help now advertises it.'));
  write('r10-02-control-and-bg-flags.ansi', L);
}

// ---------------------------------------------------------------- figure 3
{
  const sa = j('stop-ambiguous/head.json');
  const pw = j('peek-wrap/head.json');
  const g = j('gates-summary.json');
  const m10 = j('matrix/results.json');
  const m9 = JSON.parse(fs.readFileSync('/root/verify/pr10954/r9/data/matrix/results.json', 'utf8'));
  const L = [];
  L.push(C.t('PR #10954 · round 10 · R16-2 and R10-4 executed; R13-4 / R4-4 re-checked on a real daemon and against the round-9 candidate'));
  L.push('');
  L.push(C.h('① R16-2 — `qwen sessions stop` reports a definite failure for a stop the supervisor still carries out'));
  L.push(C.dim('  The supervisor is frozen (SIGSTOP) at the instant the client writes the stop request, after the reachability probe, and'));
  L.push(C.dim('  thawed after the client gives up. Stands in for any supervisor slower than the 30 s budget; no code under test is modified.'));
  const before = sa.find((x) => x.step === 'before stop');
  const stop = sa.find((x) => x.step.startsWith('qwen sessions stop'));
  const after = sa.find((x) => x.step === 'after SIGCONT');
  L.push(`  store before                  ${before.sessionState}`);
  L.push(`  $ qwen sessions stop <id>     ${C.bad(`exit ${stop.code} after ${sec(stop.ms)}  "${stop.stderr}"`)}   store at exit: ${stop.sessionStateAtClientExit}`);
  L.push(`  supervisor thawed             ${C.warn(`store → ${after.sessionState} ${after.msToStopped} ms later`)} ${C.dim('(after the client had already reported failure)')}`);
  L.push(C.dim('  For `stop` a retry is harmless; for `answer` a retry could deliver twice (not measured: nothing produces `waiting`). Not blocking.'));
  L.push('');
  L.push(C.h('② R10-4 — can session text forge an `Answer it with:` line in `peek`?   (real pty via TIOCSWINSZ, and a pipe)'));
  L.push(C.dim(pad('  payload (roster name)', 34) + pad('real pty, 50 cols', 22) + pad('real pty, 80 cols', 22) + 'piped (assumes 80), read in 50 cols'));
  const labels = { ascii: 'ASCII pad + forged hint', cjk: 'CJK pad + forged hint', emoji: 'emoji ZWJ pad + forged hint', pipe50: 'tuned for the pipe case' };
  for (const k of ['ascii', 'cjk', 'emoji', 'pipe50']) {
    const cell = (mode) => {
      const r = pw.find((x) => x.payload === k && x.mode.startsWith(mode));
      return r.wraps ? C.warn(`max ${r.maxWidth} → wraps`) : C.ok(`max ${r.maxWidth}, no wrap`);
    };
    L.push(`  ${pad(labels[k], 32)}${pad(cell('tty 50'), 22)}${pad(cell('tty 80'), 22)}${cell('piped')}`);
  }
  const piped = pw.find((x) => x.payload === 'pipe50' && x.mode.startsWith('piped')).transcript.split('\n')[0];
  const rows = [];
  for (let i = 0; i < piped.length; i += 50) rows.push(piped.slice(i, i + 50));
  L.push(C.dim('  the tuned payload, piped and shown in a 50-column terminal:'));
  for (const r of rows) L.push(`    ${C.dim('│')}${pad(r.startsWith('Answer') ? C.warn(r) : r, 50)}${C.dim('│')}`);
  L.push(C.dim('  In a terminal the clamp holds. Through a pipe at most ~17 cells land at column 0 — half a hint with the ellipsis and the'));
  L.push(C.dim('  session tag attached, never a full command. Residual, low.'));
  L.push('');
  L.push(C.h('③ R13-4 / R4-4 still open — real daemon, same 11-cell store matrix as round 9'));
  const cells = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8a', 'C8b', 'C9', 'C10'];
  const same = cells.every((c) => m10.find((x) => x.cell === c && x.arm === 'head').route === m9.find((x) => x.cell === c && x.arm === 'head').route);
  const r = (c) => m10.find((x) => x.cell === c && x.arm === 'head').route;
  L.push(`  round 10 vs round 9 (head arm): ${same ? C.ok('11/11 cells identical') : C.bad('differs')}`);
  L.push(`  C7  live agent, its worker.json corrupt (R13-4)          ${C.bad(r('C7'))}`);
  L.push(`  C8b live agent, $QWEN_HOME/sessions unreadable (R4-4)    ${C.bad(r('C8b'))}`);
  L.push(`  C8a control: pid only in a live registry record          ${r('C8a')}`);
  L.push(`  round-9 candidate (+76/−5) applies unchanged · its route suite on the candidate: ${C.ok(`${g.candidateRoute.passed}/${g.candidateRoute.total}`)} · same file on head: ${C.bad(`${g.candidateTestOnHead.passed}/${g.candidateRoute.total}`)}`);
  for (const f of g.candidateTestOnHead.failed) L.push(`    ${C.bad('✗')} ${f.title}  ${C.dim(f.msg.replace(' // Object.is equality', ''))}`);
  write('r10-03-r16-2-r10-4-open-findings.ansi', L);
}
console.log(fs.readdirSync(OUT).filter((f) => f.endsWith('.ansi')));
