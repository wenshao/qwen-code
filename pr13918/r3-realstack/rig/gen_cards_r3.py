#!/usr/bin/env python3
"""Round-3 evidence cards for PR #13918 @ 695fcf592e (32-table schema), built from results/*.json and digest TSVs."""
import csv
import html
import json
import os
import sys

from gen_cards import FIG, RIG, load, page, turn_cell, after_cell  # noqa: F401 (reuses the round-1 styling)

NEW = '695fcf592e'
BASE = '4b6b4270d0'
CASES = [('both', 10), ('both', 20), ('both', 30), ('both', 40), ('both', 60),
         ('placement', 20), ('placement', 30), ('placement', 60),
         ('publication', 20), ('publication', 30), ('publication', 60)]
LABEL = {'both': 'both rows', 'placement': 'runtime_placement only', 'publication': 'output_publication only'}


def digests(path):
    out = {}
    for r in csv.DictReader(open(path), delimiter='\t'):
        out[r['db']] = r
    return out


def cell(r, d):
    if r is None:
        return '<td class="cell dim">not run</td>'
    dd = r['during']
    rows = [f'<div>text turn: {turn_cell(dd["textTurn"]["turn"])}</div>',
            f'<div>tool turn: {turn_cell(dd["toolTurn"]["turn"])}</div>',
            f'<div>after hold: {after_cell(r["after"])}</div>']
    if d is not None:
        mw = float(d['max_wait_s'])
        cls = 'ok' if mw <= 5.1 else 'warn'
        rows.append(f'<div class="dim">guard statement: longest wait <span class="{cls}">{mw:.2f} s</span>'
                    f' · timed out {d["timed_out"]} of {d["execs"]}</div>')
    return '<td class="cell">' + ''.join(rows) + '</td>'


def card_matrix(tag, dig):
    rows = []
    for kind, hold in CASES:
        b, n = f'b_{tag}_{kind}_{hold}', f'r_{tag}_{kind}_{hold}'
        rb, rn = load(b), load(n)
        assert rb is not None and rn is not None, (b, n)
        rows.append(f'<tr><td class="k">{LABEL[kind]} · {hold} s</td>{cell(rb, dig.get("r18_" + b))}{cell(rn, dig.get("r18_" + n))}</tr>')
    body = f'''
<h1>Mid-turn tenant-guard hold, round 3: head {NEW} vs main {BASE}, 32-table schema</h1>
<p class="sub">Same rig as rounds 1–2, ported to the consolidated schema (#14069): Spring jar + embedded Runtime Broker + packaged Hosted Harness (dist/cli.js) + MySQL 8.4.7 +
scripted model. Each turn is parked inside the model call, an external transaction takes the <span class="mono">ma_tenant_guard</span> row(s) with the product's own
<span class="mono">INSERT … ON DUPLICATE KEY UPDATE</span> + primary-key <span class="mono">FOR UPDATE</span>, and the model is released 1 s later. Writer lease 60 s, Druid max-active 20.
A fresh stack per arm per case; both arms run side by side. Guard-statement figures come from performance_schema statement digests for each run's own schema.</p>
<table><tr><th style="width:200px">Held rows · duration</th><th>main {BASE} (merge-base)</th><th>new head {NEW}</th></tr>
{''.join(rows)}</table>
'''
    return body


def burst_rows(spec):
    def oc(x):
        parts = []
        for k, v in sorted(x['outcomes'].items(), key=lambda kv: -kv[1]):
            cls = 'ok' if k == 'COMPLETED' else 'bad'
            label = 'never admitted (first turn still pending)' if k == 'no-turn' else k
            parts.append(f'<span class="{cls}">{v} {html.escape(label)}</span>')
        tail = f' <span class="dim">p50 {x["p50"]/1000:.1f}s · max {x["max"]/1000:.1f}s</span>' if x.get('p50') else ''
        return ' · '.join(parts) + tail
    rows = []
    for engine, name, label in spec:
        p = f'{RIG}/results/{name}/burst.json'
        assert os.path.exists(p), p
        r = json.load(open(p))
        rec = (r.get('recovery') or {}).get('turn') or {}
        rec_s = '<span class="ok">✓</span>' if rec.get('status') == 'COMPLETED' else '<span class="bad">✗</span>'
        b0, b1 = r.get('innodbDeadlocksBefore'), r.get('innodbDeadlocksAfter')
        if b0 is None or b1 is None:
            dls = '<span class="dim">—</span>'
        else:
            dl = b1 - b0
            dls = f'<span class="{"ok" if dl == 0 else "bad"}">{dl}</span>'
        rows.append(f'<tr><td class="k">{engine}</td><td class="k">{r["n"]} Sessions</td><td class="k">{label}</td>'
                    f'<td>{oc(r["firstTurns"])}</td><td>{oc(r["secondTurns"])}</td>'
                    f'<td class="mono">{r["springCounts"]["poolTimeout"]} / {dls} / {r["harnessCounts"]["writesStopped"]}</td><td>{rec_s}</td></tr>')
    return ''.join(rows)


def card_burst(spec, note):
    body = f'''
<h1>Concurrent Session bursts at production pool defaults, round 3</h1>
<p class="sub">N Sessions created at once through <span class="mono">POST /v1/agents/sessions</span>, then one more turn each, all concurrently. Druid max-active 20, max-wait 30 s.
Fresh stack per arm. MySQL 8.4.7: arms side by side. MariaDB 10.11.18 (the CI image): one arm at a time, so the server-wide deadlock counter belongs to that arm; both MariaDB jars
carry #14177's catalog fix (without it, main and this head both fail schema initialisation on MariaDB).</p>
<table><tr><th>engine</th><th>burst</th><th>arm</th><th>first turn (create)</th><th>second turn</th><th>pool timeouts / InnoDB deadlocks / write-latched</th><th>fresh Session after</th></tr>
{burst_rows(spec)}</table>
<div class="note green">{note}</div>
'''
    return body


if __name__ == '__main__':
    what = sys.argv[1]
    if what == 'matrix':
        tag, tsv, note = sys.argv[2], sys.argv[3], sys.argv[4]
        body = card_matrix(tag, digests(tsv)) + f'<div class="note green">{note}</div>'
        open(f'{FIG}/07-r3-hold-matrix.html', 'w').write(page('Guard hold matrix r3', body))
    elif what == 'burst':
        spec = json.loads(sys.argv[2])
        open(f'{FIG}/08-r3-burst.html', 'w').write(page('Pool burst r3', card_burst(spec, sys.argv[3])))
    print('r3 card written:', what)
