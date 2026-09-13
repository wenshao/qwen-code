#!/usr/bin/env python3
"""Round-3 figures for PR #11727 (head fd61c750b0). Reuses compose.py helpers."""
import json, pathlib, re, sys
sys.path.insert(0, '/root/git/h11727')
import compose as C
from compose import table, cell, summ, tail_rows, stack

FIG = pathlib.Path('/root/git/h11727/fig-r3')
FIG.mkdir(exist_ok=True)
DASH = ('—', 'plain')


def verdict(label):
  s = summ(label)
  if not s:
    return ('(missing)', 'warn')
  text, _ = cell(label)
  if s['len'] > 20000 and not s['sentinel'] and not s['stub']:
    return (text, 'bad')
  return (text, 'good' if (s['exit'] and s['tail']) else ('warn' if s['exit'] else 'bad'))


def fig_matrix():
  r = lambda arm, key: f'r3-{arm}-{key}'
  def row(name, body, key, eb=None, eh=None):
    return [name, body, cell(r('base', key), eb), cell(r('head', key), eh)]
  rows = [
    ('§', 'THE WINDOW — default config, formatted body between the 28,000 gate and the 30,000 Shell budget'),
    row('s1  succeeds', '28.7k, exit 0', 's1-ok-window'),
    row('s2  fails', '28.7k, exit 3', 's2-fail-window'),
    row('s5  times out (4 s)', '28.6k partial', 's5-timeout-window'),
    row('s7b slow + advisory, fits reservation', '28.7k + 637', 's7b-slow-fits'),
    row('s7  slow + advisory, in the 637-char band', '29.8k + 637', 's7-slow-band'),
    row('s8  slow, one 28.8k-char line', '29.8k + 637', 's8-slow-oneline-band'),
    ('§', 'CONTROLS — must not change'),
    row('s3  small', '407, exit 0', 's3-small', 'same', 'same'),
    row('s6  below the gate', '26.1k, exit 4', 's6-below-gate', 'same', 'same'),
    row('s4  far over budget', '64k, exit 2', 's4-far-over', 'same', 'same'),
    row('s5b times out, far over budget', '64k partial', 's5b-timeout-far-over', 'same', 'same'),
    ['s2  with truncateToolOutputThreshold 25000', '28.7k, exit 3', cell('r3-base-s2-t25k', 'same'), cell('r3-head-s2-t25k', 'same')],
    ('§', 'RESIDUALS — not changed by this PR'),
    ['s2  + PostToolUseFailure hook (short ctx)', '28.7k, exit 3', cell('r3-base-s2-hook', 'bad'), cell('r3-head-s2-hook', 'bad')],
    ['s5  + hook returning 50k additionalContext', '28.6k + 50k', cell('r3-base-s5-hookbig', 'warn'), cell('r3-head-s5-hookbig', 'warn')],
  ]
  table(FIG / '01-real-cli-ab.png',
        'PR #11727 @ fd61c750b0 — what the model receives from run_shell_command (real qwen CLI, headless)',
        'BASE = merge-base ee1ebcc167 · HEAD = fd61c750b0 · mock OpenAI endpoint records the tool message exactly as sent',
        ['Scenario', 'Formatted body', 'BASE (merge-base)', 'HEAD (fd61c750b0)'],
        rows, [330, 130, 420, 420],
        notes=['stub = <persisted-output> head-only preview · head+tail = Shell\'s keep-both preview + spill file · tail / exit = the last output line / "Exit Code:" line reached the model',
               'Timeouts carry no exit code by design. The 50k-hook row is bounded only by the aggregate batch budget on both arms.'])


def fig_critical():
  arms = ('base', 'noclamp', 'nohalfcap', 'head')
  rows = [('§', 'explicit tiny threshold + long-running command + non-zero exit (round-2 Critical and round-2 §3)')]
  for name, key, ran in [
    ('c1  T=100, slow, exit 3', 'c1-t100-slow-fail', ('base', 'noclamp', 'head')),
    ('c4  T=600, slow, exit 3', 'c4-t600-slow-fail', arms),
    ('c2  T=100, slow, exit 0 (success path)', 'c2-t100-slow-ok', ('base', 'noclamp', 'head')),
    ('c3  T=100, fast, exit 3 (no advisory)', 'c3-t100-fast-fail', ('base', 'noclamp', 'head')),
  ]:
    tiny = 'T=100' in name
    def crit(label):
      s = summ(label)
      if not s:
        return ('(missing)', 'warn')
      text, _ = cell(label)
      if s['len'] > 20000 and not s['sentinel'] and not s['stub']:
        return (text, 'bad')
      if s['tail'] and s['exit']:
        return (text, 'good')
      return (text, 'warn' if (tiny or s['exit']) else 'bad')
    rows.append([name] + [crit(f'r3-{a}-{key}') if a in ran else DASH for a in arms])
  table(FIG / '02-critical.png',
        'Both earlier findings are closed at fd61c750b0 — one CLI, one build, in-place mutant arms',
        'NOCLAMP = clamp and half-cap removed from compiled shell.js (== 8ac6e4d602) · NOHALFCAP = half-cap removed only (== c2d3c24df8)',
        ['Scenario', 'BASE (merge-base)', 'NOCLAMP (= 8ac6e4d602)', 'NOHALFCAP (= c2d3c24df8)', 'HEAD (fd61c750b0)'],
        rows, [290, 350, 350, 350, 350],
        notes=['red = unbounded body, or a preview that lost both the last line and the exit code where BASE kept them · green = bounded, last line and exit code kept',
               'amber = bounded; a 100-char budget cannot hold the exit code on any arm, so the point of the T=100 rows is that HEAD stays bounded.'])


def fig_sweep():
  Ts = [300, 600, 700, 800, 1000, 1300, 2000, 4000]
  rows = [('§', 'long-running command (advisory reserved) · 148.8k output · exit 3')]
  for T in Ts:
    r2 = f'sw-head-slow-t{T}'  # round-2 run on the c2d3c24df8 build
    nh = f'r3-sw-nohalfcap-slow-t{T}' if T in (300, 800) else ('r3-nohalfcap-c4-t600-slow-fail' if T == 600 else None)
    rows.append([f'T = {T:,}', verdict(f'r3-sw-base-slow-t{T}'),
                 verdict(r2) if summ(r2) else DASH,
                 verdict(nh) if nh else DASH,
                 verdict(f'r3-sw-head-slow-t{T}')])
  rows.append(('§', 'fast command (no advisory, nothing reserved) — control'))
  for T in (600, 1000):
    rows.append([f'T = {T:,}', verdict(f'r3-sw-base-fast-t{T}'), DASH, DASH, verdict(f'r3-sw-head-fast-t{T}')])
  table(FIG / '03-threshold-sweep.png',
        'Explicit truncateToolOutputThreshold sweep — the round-2 preview starvation is fixed',
        'ROUND 2 = the c2d3c24df8 build measured last round · NOHALFCAP = this build with the half-cap removed, reproducing round 2 in-place',
        ['Threshold', 'BASE (merge-base)', 'ROUND 2 (c2d3c24df8)', 'NOHALFCAP (this build)', 'HEAD (fd61c750b0)'],
        rows, [130, 390, 390, 390, 390],
        notes=['green = last output line and "Exit Code:" reached the model · amber = exit code only · red = neither'])


def fig_tests():
  res = json.loads(pathlib.Path('/root/git/h11727/out/mutants-r3/results-all.json').read_text())
  notes = {'M1c': 'equivalent: with the half-cap, T − min(r, ⌊T/2⌋) ≥ 1 for any T ≥ 1',
           'M12': 'equivalent today: only Shell marks, and Shell declares a budget',
           'M2b': 'no test pins the 2-char separator per appended string (at most a 4-char drift)'}
  rows = [
    ('§', 'Suites'),
    ['HEAD fd61c750b0', 'shell.test.ts + coreToolScheduler.test.ts', ('759 passed', 'good')],
    ['Counterfactual', 'PR test files × merge-base production code — the 13 fix-dependent tests fail', ('13 failed · 746 passed', 'good')],
    ('§', 'Mutation probes on the production hunks (src, restored byte-for-byte, tree clean after)'),
  ]
  for m in res:
    killed = m['status'] == 'KILLED'
    words = re.findall(r'[a-z]{5,}', m['desc'].lower())
    names = [x.split(' > ')[-1] for x in (m.get('failing') or [])]
    names.sort(key=lambda n: -sum(w in n.lower() for w in words))
    by = names[0] if names else ''
    note = notes.get(m['id'], by[:92] if killed else '')
    kind = 'good' if killed else ('warn' if m['id'] in notes else 'bad')
    rows.append([f"{m['id']}  {m['desc']}", note, (m['status'], kind)])
  killed = sum(1 for m in res if m['status'] == 'KILLED')
  table(FIG / '04-tests-mutants.png',
        f'Tests: pass, depend on the fix, and {killed}/{len(res)} mutants are killed',
        'vitest, packages/core, Linux x64 Node 22.22.2',
        ['Probe', 'Detail / killed by', 'Result'],
        rows, [420, 720, 180])


def fig_pairs():
  stack([tail_rows(FIG / 'tui-r3-nohalfcap-c4.png', 27), tail_rows(FIG / 'tui-r3-head-c4.png', 30)], FIG / 'tui-c4-nohalfcap-vs-head.png')


if __name__ == '__main__':
  which = set(sys.argv[1:]) or {'matrix', 'critical', 'sweep', 'tests', 'pairs'}
  for name in ('matrix', 'critical', 'sweep', 'tests', 'pairs'):
    if name in which:
      globals()[f'fig_{name}']()
