#!/usr/bin/env python3
"""Round-2 evidence cards for PR #13918 @ 2f467c61, built from results/*.json and the digest TSV."""
import csv
import html
import json
import os

from gen_cards import CSS, FIG, RIG, load, page, turn_cell, after_cell  # noqa: F401 (reuses the round-1 styling)


def cell(r, repeat=None):
    if r is None:
        return '<td class="cell dim">not run</td>'
    d = r['during']
    rows = [f'<div>text turn: {turn_cell(d["textTurn"]["turn"])}</div>',
            f'<div>tool turn: {turn_cell(d["toolTurn"]["turn"])}</div>',
            f'<div>after hold: {after_cell(r["after"])}</div>']
    if repeat is not None:
        same = all(repeat['during'][k]['turn']['status'] == d[k]['turn']['status'] for k in ('textTurn', 'toolTurn')) \
            and after_cell(repeat['after']) == after_cell(r['after'])
        rows.append(f'<div class="dim">repeat run: {"same outcome" if same else "DIFFERENT"}</div>')
    return '<td class="cell">' + ''.join(rows) + '</td>'


# label, base (today), base repeat, old head 238bebd5 (round 1), new head (today), new head repeat
MATRIX = [
    ('both rows · 10 s', 'b_r2_both_10', None, 'h_m4_both_10', 'n_r2_both_10', None),
    ('both rows · 20 s', 'b_r2_both_20', 'b_r3_both_20', 'h_m2_both_20', 'n_r2_both_20', 'n_r3_both_20'),
    ('both rows · 30 s', 'b_r2_both_30', None, 'h_m2_both_30', 'n_r2_both_30', None),
    ('both rows · 40 s', 'b_r2_both_40', None, 'h_m2_both_40', 'n_r2_both_40', None),
    ('both rows · 60 s', 'b_r2_both_60', None, 'h_m1_both_60', 'n_r2_both_60', None),
    ('placement guard only · 30 s', 'b_r2_placement_30', 'b_r3_placement_30', 'h_m2_placement_30', 'n_r2_placement_30', 'n_r3_placement_30'),
    ('publication CAS row only · 30 s', 'b_r2_publication_30', 'b_r3_publication_30', 'h_m2_publication_30', 'n_r2_publication_30', 'n_r3_publication_30'),
    ('publication CAS row only · 60 s', 'b_r2_publication_60', None, 'h_m1_publication_60', 'n_r2_publication_60', None),
]


def card_matrix():
    rows = []
    for label, b, br, h, n, nr in MATRIX:
        for name in (b, h, n):
            assert load(name) is not None, name
        rb, rbr, rh, rn, rnr = load(b), load(br) if br else None, load(h), load(n), load(nr) if nr else None
        rows.append(f'<tr><td class="k">{label}</td>{cell(rb, rbr)}{cell(rh)}{cell(rn, rnr)}</tr>')
    body = f'''
<h1>Mid-turn tenant-guard hold — re-run on head 2f467c61 (base and new head side by side)</h1>
<p class="sub">Same rig as round 1: Spring jar + embedded Runtime Broker + packaged Hosted Harness (dist/cli.js) + MySQL 8.4.7 + scripted model. The turn is parked inside the model
call, an external transaction holds the guard row(s), the model is released 1 s later. Writer lease 60 s, Druid max-active 20. Fresh stack per arm per case; base and new head
run in parallel. base = main fd95f04 (merge-base, re-measured today) · round-1 head = 238bebd5 (earlier run, for reference) · new head = 2f467c61.</p>
<table><tr><th style="width:190px">Held rows · duration</th><th>base (main) — today</th><th>round-1 head 238bebd5</th><th>new head 2f467c61 — today</th></tr>
{''.join(rows)}</table>
<div class="note green"><b>F1 fixed.</b> New head completes both turns at the hold's end for 10–30 s holds of every row kind (the round-1 head latched them), matches base at 40 s
(text turn completes, tool turn stays RUNNING on both), and beats base at 60 s, where base latches everything (both rows: text turn completes and the idle Session stays
usable; publication row only: the idle Session stays usable). Repeat runs at 20 s / 30 s gave the same outcome on both arms.</div>
'''
    open(f'{FIG}/04-r2-hold-matrix.html', 'w').write(page('Guard hold matrix r2', body))


def card_burst():
    def b(name):
        p = f'{RIG}/results/{name}/burst.json'
        assert os.path.exists(p), p
        return json.load(open(p))

    def oc(x):
        parts = []
        for k, v in sorted(x['outcomes'].items(), key=lambda kv: -kv[1]):
            cls = 'ok' if k == 'COMPLETED' else 'bad'
            label = 'never admitted (first turn still pending)' if k == 'no-turn' else k
            parts.append(f'<span class="{cls}">{v} {html.escape(label)}</span>')
        tail = f' <span class="dim">p50 {x["p50"]/1000:.1f}s · max {x["max"]/1000:.1f}s</span>' if x.get('p50') else ''
        return ' · '.join(parts) + tail

    rows = []
    spec = [(40, 'q1', 'n', 'new head 2f467c61'), (40, 'q1', 'b', 'base'),
            (40, 'q2', 'n', 'new head 2f467c61'), (40, 'q2', 'b', 'base'),
            (60, 'q3', 'n', 'new head 2f467c61'), (60, 'q3', 'b', 'base'),
            (80, 'q4', 'n', 'new head 2f467c61'), (80, 'q4', 'b', 'base'),
            (40, 'k1', 'h', 'round-1 head 238bebd5'), (40, 'k4', 'h', 'round-1 head 238bebd5')]
    for n, tag, arm, label in spec:
        r = b(f'{arm}_{tag}_p20_n{n}')
        rec = (r.get('recovery') or {}).get('turn') or {}
        rec_s = '<span class="ok">✓</span>' if rec.get('status') == 'COMPLETED' else '<span class="bad">✗</span>'
        dim = ' class="dim"' if arm == 'h' else ''
        rows.append(f'<tr{dim}><td class="k">{n} Sessions · run {tag}</td><td class="k">{label}</td>'
                    f'<td>{oc(r["firstTurns"])}</td><td>{oc(r["secondTurns"])}</td>'
                    f'<td class="mono">{r["springCounts"]["poolTimeout"]} / {r["harnessCounts"]["writesStopped"]}</td><td>{rec_s}</td></tr>')
    body = f'''
<h1>Concurrent Session burst at production pool defaults — re-run on head 2f467c61</h1>
<p class="sub">N Sessions created at once through <span class="mono">POST /v1/agents/sessions</span>, each then sent one more turn, all concurrently. Druid max-active 20, max-wait 30 s.
Fresh stack per arm; new head and base run side by side on the same MySQL 8.4.7. The last two rows are the round-1 head runs, kept for reference.</p>
<table><tr><th>Burst</th><th>arm</th><th>first turn (create)</th><th>second turn</th><th>pool timeouts / write-latched</th><th>fresh Session after</th></tr>
{''.join(rows)}</table>
<div class="note green"><b>F2 fixed.</b> With the dedicated-connection probe gone (the v2 check now reads on the caller's own transaction connection), new head completes every
turn at 40 (twice), 60 and 80 concurrent Sessions with zero pool timeouts, at the same or slightly lower latency than base. Round-1 head lost the whole 40-Session burst twice.</div>
'''
    open(f'{FIG}/05-r2-pool-burst.html', 'w').write(page('Pool burst r2', body))


def card_mechanism():
    rows = list(csv.DictReader(open(f'{RIG}/results/r3-guard-digest.tsv'), delimiter='\t'))
    assert len(rows) == 12, len(rows)
    trs = []
    for r in rows:
        arm = 'new head' if '_n_' in r['db'] else 'base'
        case = r['db'].split('_r3_')[1].replace('_', ' ') + ' s'
        bounded = float(r['max_wait_s']) <= 5.1
        mw = f'<span class="{"ok" if bounded else "warn"}">{r["max_wait_s"]} s</span>'
        to = int(r['timed_out'])
        trs.append(f'<tr><td class="k">{case}</td><td class="k">{arm}</td><td>{r["guard_row"]}</td><td class="mono">{r["execs"]}</td>'
                   f'<td class="mono">{to}</td><td class="mono">{mw}</td></tr>')
    body = f'''
<h1>What the server actually did during the hold — MySQL statement digests</h1>
<p class="sub">performance_schema.events_statements_summary_by_digest, truncated before the repeat run (r3), filtered to each run's own schema. The guard rows are taken with
<span class="mono">INSERT … ON DUPLICATE KEY UPDATE</span>; "timed out" = statements that ended with an error (the 5 s <span class="mono">setQueryTimeout</span> on new head).</p>
<table><tr><th>hold</th><th>arm</th><th>guard row</th><th>executions</th><th>timed out</th><th>longest wait</th></tr>
{''.join(trs)}</table>
<div class="note green">Base simply waits the hold out (up to 28.9 s inside one statement). New head never waits longer than 5.01 s per statement; the statement times out (6–12 times
per run), the store answers 503 <span class="mono">tenant_guard_contended</span>, the client retries inside its 30 s budget, and the turns still complete at the hold's end.
New head also issues about a third of base's publication-row statements (126–136 vs 369–375), since ordinary writes no longer take that row.</div>
'''
    open(f'{FIG}/06-r2-guard-digest.html', 'w').write(page('Guard digest r2', body))


card_matrix()
card_burst()
card_mechanism()
print('r2 cards written')
