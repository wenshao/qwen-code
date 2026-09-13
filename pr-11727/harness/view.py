#!/usr/bin/env python3
"""Side-by-side ANSI panel of the exact model-facing tool text for two runs."""
import sys, pathlib, re, textwrap

OUT = pathlib.Path('/root/git/h11727/out')
W = 92
RST, B, DIM = '\x1b[0m', '\x1b[1m', '\x1b[2m'
YEL, GRN, RED, CYN = '\x1b[33m', '\x1b[32m', '\x1b[31m', '\x1b[36m'


def lines_of(label, max_rows):
  text = (OUT / label / 'tool-content.txt').read_text()
  true_len = len(text)
  text = re.sub(r'/root/git/h11727/homes/[^/]+/\.qwen/tmp/[0-9a-f]+/', '~/.qwen/tmp/<project>/', text)
  rows = []
  for ln in text.split('\n'):
    rows += textwrap.wrap(ln, W) or ['']
  if len(rows) > max_rows:
    rows = rows[: max_rows - 1] + [f'… ({len(rows) - max_rows + 1} more wrapped lines)']
  return rows, true_len


def paint(row):
  if 'Exit Code:' in row or 'TAIL-STATUS' in row:
    return GRN + B + row + RST
  if row.startswith('Truncated part of the output:'):
    return YEL + B + row + RST
  if row.startswith('Note: this foreground') or row.startswith('Tool output was too large'):
    return CYN + row + RST
  return row


def main(left, right, title_l, title_r, dst, max_rows=34):
  L, nl = lines_of(left, max_rows)
  R, nr = lines_of(right, max_rows)
  out = [f'{B}{YEL}{title_l:<{W}}{RST}  │  {B}{YEL}{title_r}{RST}',
         f'{DIM}{f"{nl:,} chars reached the model":<{W}}{RST}  │  {DIM}{nr:,} chars reached the model{RST}',
         '─' * W + '──┼──' + '─' * W]
  for i in range(max(len(L), len(R))):
    l = L[i] if i < len(L) else ''
    r = R[i] if i < len(R) else ''
    out.append(paint(l) + ' ' * (W - len(l)) + '  │  ' + paint(r))
  # flag the empty preview explicitly when the right side has one
  for i, r in enumerate(R):
    if r.startswith('Truncated part of the output:') and i + 1 < len(R) and R[i + 1] == '' and (i + 2 >= len(R) or R[i + 2] == ''):
      idx = 3 + i + 1
      out[idx] = out[idx] + RED + B + '◀ empty: no command, no rows, no Exit Code' + RST
  pathlib.Path(dst).write_text('\n'.join(out) + '\n')


if __name__ == '__main__':
  main(*sys.argv[1:6])
