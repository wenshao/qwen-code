#!/usr/bin/env python3
"""Render the verification tables for PR #11727 from out/<label>/summary.json."""
import json, pathlib, sys
from PIL import Image, ImageDraw, ImageFont

H = pathlib.Path('/root/git/h11727')
OUT = H / 'out'
FIG = H / 'fig'
FIG.mkdir(exist_ok=True)
FD = '/usr/share/fonts/truetype/dejavu/'
S = 2  # retina scale
F = lambda size, bold=False: ImageFont.truetype(FD + ('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf'), size * S)
FM = lambda size: ImageFont.truetype(FD + 'DejaVuSansMono.ttf', size * S)

BG = (255, 255, 255); INK = (31, 35, 40); MUTED = (101, 109, 118); RULE = (208, 215, 222)
HEAD_BG = (36, 41, 47); HEAD_INK = (240, 246, 252); SECTION_BG = (246, 248, 250)
KIND = {
  'good': ((218, 251, 225), (17, 99, 41)),
  'bad': ((255, 235, 233), (164, 14, 38)),
  'warn': ((255, 248, 197), (125, 78, 0)),
  'same': ((246, 248, 250), (87, 96, 106)),
  'plain': (BG, INK),
}


def summ(label):
  p = OUT / label / 'summary.json'
  return json.loads(p.read_text()) if p.exists() else None


def cell(label, expect=None, compare=None):
  """-> (text, kind). kind derives from what reached the model."""
  s = summ(label)
  if not s:
    return ('(missing)', 'warn')
  shape = 'stub' if s['stub'] else ('head+tail' if s['sentinel'] else 'whole')
  parts = [f"{shape} {s['len']:,}", f"tail {'✓' if s['tail'] else '✗'}", f"exit {s['exit'] if s['exit'] is not None else '✗'}"]
  if s.get('advisory'):
    parts.append('advisory')
  text = ' · '.join(parts)
  if expect:
    return (text, expect)
  return (text, 'good' if (s['tail'] and (s['exit'] is not None or 'timeout' in label)) else 'bad')


def table(path, title, subtitle, header, rows, widths, notes=()):
  pad = 14 * S
  row_h = 34 * S
  sec_h = 30 * S
  title_h = 64 * S if subtitle else 40 * S
  width = sum(widths) * S + 2 * pad
  height = title_h + row_h + sum(sec_h if r[0] == '§' else row_h for r in rows) + pad * 2 + len(notes) * 22 * S + (8 * S if notes else 0)
  img = Image.new('RGB', (width, height), BG)
  d = ImageDraw.Draw(img)
  y = pad
  d.text((pad, y), title, font=F(17, True), fill=INK)
  if subtitle:
    d.text((pad, y + 28 * S), subtitle, font=F(12), fill=MUTED)
  y += title_h
  x = pad
  d.rectangle([pad, y, width - pad, y + row_h], fill=HEAD_BG)
  for h, w in zip(header, widths):
    d.text((x + 10 * S, y + 9 * S), h, font=F(12, True), fill=HEAD_INK)
    x += w * S
  y += row_h
  for r in rows:
    if r[0] == '§':
      d.rectangle([pad, y, width - pad, y + sec_h], fill=SECTION_BG)
      d.text((pad + 10 * S, y + 7 * S), r[1], font=F(12, True), fill=MUTED)
      y += sec_h
      continue
    x = pad
    for c, w in zip(r, widths):
      text, kind = c if isinstance(c, tuple) else (c, 'plain')
      bg, fg = KIND[kind]
      if kind != 'plain':
        d.rounded_rectangle([x + 4 * S, y + 4 * S, x + w * S - 4 * S, y + row_h - 4 * S], radius=5 * S, fill=bg)
      font = FM(12) if kind != 'plain' else F(12)
      d.text((x + 10 * S, y + 9 * S), text, font=font, fill=fg)
      x += w * S
    d.line([pad, y + row_h, width - pad, y + row_h], fill=RULE, width=S)
    y += row_h
  y += 8 * S
  for n in notes:
    d.text((pad, y), n, font=F(11), fill=MUTED)
    y += 22 * S
  img.save(path)
  print(path, img.size)


def fig_matrix():
  B, Hd = 'base', 'head'
  r = lambda arm, key: f'r1-{arm}-{key}'
  def row(name, body, key, expect_b=None, expect_h=None):
    return [name, body, cell(r(B, key), expect_b), cell(r(Hd, key), expect_h)]
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
    ['s2  with truncateToolOutputThreshold 25000', '28.7k, exit 3', cell('r1-base-s2-t25k', 'same'), cell('r1-head-s2-t25k', 'same')],
    ('§', 'RESIDUALS — not changed by this PR'),
    ['s2  + PostToolUseFailure hook (short ctx)', '28.7k, exit 3', cell('r1-base-s2-hook', 'bad'), cell('r1-head-s2-hook', 'bad')],
    ['s5  + hook returning 50k additionalContext', '28.6k + 50k', cell('r1-base-s5-hookbig', 'warn'), cell('r1-head-s5-hookbig', 'warn')],
  ]
  table(FIG / '01-real-cli-ab.png',
        'PR #11727 @ c2d3c24df8 — what the model receives from run_shell_command (real qwen CLI, headless)',
        'BASE = merge-base ee1ebcc167 · HEAD = c2d3c24df8 · mock OpenAI endpoint records the tool message exactly as sent · r1 and r2 runs agree',
        ['Scenario', 'Formatted body', 'BASE (merge-base)', 'HEAD (PR)'],
        rows, [330, 130, 420, 420],
        notes=['stub = <persisted-output> with a ~2k head-only preview · head+tail = Shell\'s own keep-both preview + spill file · tail = the command\'s last output line reached the model · exit = the "Exit Code:" line reached the model',
               'Timeouts carry no exit code by design. The 50k-hook row is bounded only by the aggregate batch budget on both arms (base 52,460 → head 78,657).'])


def fig_critical():
  rows = [('§', 'qqqys Critical (8ac6e4d602): explicit tiny threshold + long-running command + non-zero exit')]
  specs = [
    ('c1  T=100, slow, exit 3', 'c1-t100-slow-fail'),
    ('c4  T=600, slow, exit 3', 'c4-t600-slow-fail'),
    ('c2  T=100, slow, exit 0 (success path)', 'c2-t100-slow-ok'),
    ('c3  T=100, fast, exit 3 (no advisory)', 'c3-t100-fast-fail'),
  ]
  for name, key in specs:
    cells = []
    for arm in ('base', 'noclamp', 'head'):
      s = summ(f'r1-{arm}-{key}')
      if not s:
        cells.append(('(missing)', 'warn')); continue
      unbounded = s['len'] > 20000
      text, _ = cell(f'r1-{arm}-{key}')
      cells.append((text, 'bad' if unbounded else ('good' if s['exit'] else 'warn')))
    rows.append([name, '148.8k body'] + cells)
  table(FIG / '02-critical-abc.png',
        'The Critical is real on 8ac6e4d602 and closed by aee22dfbfd — same CLI, three core builds',
        'NOCLAMP = head with Math.max(1, …) removed from compiled shell.js — byte-equivalent to 8ac6e4d602\'s shell.ts (git diff 8ac6e4d602 aee22dfbfd -- shell.ts is exactly the clamp)',
        ['Scenario', 'Output', 'BASE (merge-base)', 'NOCLAMP (= 8ac6e4d602)', 'HEAD (c2d3c24df8)'],
        rows, [300, 110, 380, 380, 380],
        notes=['red = unbounded body reached the model · amber = bounded, but the tail and exit code were cut away · green = bounded and the exit code survived',
               'c4 is a new observation: HEAD is bounded but its preview is EMPTY — the 637-char reservation consumes the whole 600-char budget, the clamp leaves 1 char.'])


def fig_sweep():
  Ts = [300, 600, 700, 800, 1000, 1300, 1600, 2000, 4000]
  rows = [('§', 'slow (advisory fires, reserves ~637 chars) · 148.8k output · exit 3')]
  for T in Ts:
    rows.append([f'T = {T:,}', f'{max(1, T - 637):,}'] + [cell(f'sw-{arm}-slow-t{T}', None) for arm in ('base', 'head')])
  rows.append(('§', 'fast (no advisory, nothing reserved) — control'))
  for T in (600, 1000):
    rows.append([f'T = {T:,}', f'{T:,}'] + [cell(f'sw-{arm}-fast-t{T}', None) for arm in ('base', 'head')])
  table(FIG / '03-threshold-sweep.png',
        'Explicit truncateToolOutputThreshold sweep — where the reservation starves the Shell preview',
        'Long-running foreground command, exit 3. HEAD body budget = max(1, T − reserved metadata); preview = min(4000, that).',
        ['Threshold', 'HEAD body budget', 'BASE (merge-base)', 'HEAD (c2d3c24df8)'],
        rows, [130, 150, 420, 420],
        notes=['green = the command\'s last line and "Exit Code:" reached the model · red = they did not'])


def fig_tests():
  res = json.loads((OUT / 'mutants' / 'results-M1-M12.json').read_text())
  m13 = json.loads((OUT / 'mutants' / 'results-M13.json').read_text())
  res += [m for m in m13 if m['id'] == 'M13']
  rows = [
    ('§', 'Suites'),
    ['HEAD c2d3c24df8', 'shell.test.ts + coreToolScheduler.test.ts', ('756 passed', 'good')],
    ['Counterfactual', 'PR test files × merge-base production code — the 11 new positive tests fail', ('11 failed · 745 passed', 'good')],
    ('§', 'Mutation probes on the production hunks (src, restored byte-for-byte, tree clean after)'),
  ]
  for m in res:
    killed = m['status'] == 'KILLED'
    by = (m.get('failing') or [''])[0].split(' > ')[-1] if killed else ''
    note = {'M12': 'equivalent today: only Shell marks, and Shell declares a budget',
            'M13': 'confirms R3-2: the attributionWarning half of the reservation is untested'}.get(m['id'], by[:92])
    rows.append([f"{m['id']}  {m['desc']}", note, (m['status'], 'good' if killed else ('warn' if m['id'] == 'M12' else 'bad'))])
  table(FIG / '04-tests-mutants.png',
        'Tests: pass, depend on the fix, and 11/13 mutants are killed',
        'vitest, packages/core, Linux x64 Node 22',
        ['Probe', 'Detail / killed by', 'Result'],
        rows, [400, 720, 180])


def fig_candidate():
  rows = [('§', 'explicit small threshold · long-running command · exit 3')]
  for name, b, h, c, kind in [
    ('T = 300', 'sw-base-slow-t300', 'sw-head-slow-t300', 'hc-slow-t300', None),
    ('T = 600  (c4)', 'r1-base-c4-t600-slow-fail', 'r1-head-c4-t600-slow-fail', 'hc-c4-t600', None),
    ('T = 800', 'sw-base-slow-t800', 'sw-head-slow-t800', 'hc-slow-t800', None),
    ('T = 100  (c1, the Critical)', 'r1-base-c1-t100-slow-fail', 'r1-head-c1-t100-slow-fail', 'hc-c1-t100', 'warn'),
  ]:
    rows.append([name, cell(b, kind), cell(h, kind), cell(c, kind)])
  rows.append(('§', 'default configuration — must not change'))
  for name, h, c in [
    ('s2  fails in the window', 'r1-head-s2-fail-window', 'hc-s2-fail-window'),
    ('s7b slow, fits the reservation', 'r1-head-s7b-slow-fits', 'hc-s7b-slow-fits'),
    ('s7  slow, in the 637-char band', 'r1-head-s7-slow-band', 'hc-s7-slow-band'),
  ]:
    rows.append([name, ('see figure 1', 'plain'), cell(h, 'same'), cell(c, 'same')])
  table(FIG / '06-candidate-fix.png',
        'Candidate fix, verified on the real CLI: reserve at most half the threshold',
        'CANDIDATE = head with  outputThreshold - Math.min(appendedMetadataChars, Math.floor(outputThreshold / 2))  · shell.test.ts + coreToolScheduler.test.ts stay 756/756',
        ['Scenario', 'BASE (merge-base)', 'HEAD (c2d3c24df8)', 'CANDIDATE'],
        rows, [260, 400, 400, 400],
        notes=['amber on the T = 100 row = bounded (the Critical stays closed); a 100-char budget cannot hold the exit code on any arm'])


def tail_rows(png, rows, row_px=20, pad=14, title=30):
  im = Image.open(png)
  W, Hh = im.size
  y0 = max(title, Hh - pad - rows * row_px)
  body = im.crop((0, y0, W, Hh))
  out = Image.new('RGB', (W, title + body.height), (13, 17, 23))
  out.paste(im.crop((0, 0, W, title)), (0, 0))
  out.paste(body, (0, title))
  return out


def stack(images, dst, gap=18):
  W = max(i.width for i in images)
  img = Image.new('RGB', (W, sum(i.height for i in images) + gap * (len(images) - 1)), (255, 255, 255))
  y = 0
  for i in images:
    img.paste(i, (0, y))
    y += i.height + gap
  img.save(dst)
  print(dst, img.size)


def fig_pairs():
  stack([tail_rows(FIG / 'tui-base-s2.png', 46), tail_rows(FIG / 'tui-head-s2.png', 16)], FIG / 'tui-s2-base-vs-head.png')
  stack([tail_rows(FIG / 'tui-noclamp-c1.png', 18), tail_rows(FIG / 'tui-head-c1.png', 27)], FIG / 'tui-c1-8ac6-vs-head.png')
  stack([tail_rows(FIG / 'tui-base-c4.png', 30), tail_rows(FIG / 'tui-head-c4.png', 27)], FIG / 'tui-c4-base-vs-head.png')


if __name__ == '__main__':
  which = set(sys.argv[1:]) or {'matrix', 'critical', 'sweep', 'tests', 'candidate', 'pairs'}
  if 'candidate' in which: fig_candidate()
  if 'pairs' in which: fig_pairs()
  if 'matrix' in which: fig_matrix()
  if 'critical' in which: fig_critical()
  if 'sweep' in which: fig_sweep()
  if 'tests' in which: fig_tests()
