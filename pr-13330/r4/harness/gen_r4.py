#!/usr/bin/env python3
"""Round-4 figures for PR #13330 (head 51a87ac9). Reads probe logs from ../logs, writes HTML cards to ./out."""
import html
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOGS = HERE.parent / 'logs'
OUT = HERE / 'out'
OUT.mkdir(exist_ok=True)
ARMS = [('base', 'base ba8615f4', 'main tip the PR targets'),
        ('head', 'head 51a87ac9', 'this PR now (F1 fixed)')]

CSS = """
*{box-sizing:border-box}body{margin:0;background:#0d1117;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e6edf3}
.card{display:inline-block;margin:20px;padding:22px 26px;background:#0d1117;border:1px solid #30363d;border-radius:10px;min-width:900px}
h1{font-size:21px;margin:0 0 4px}h2{font-size:15px;margin:18px 0 6px;color:#79c0ff}
.sub{color:#8b949e;font-size:13px;margin-bottom:12px}
table{border-collapse:collapse;font-size:12.5px;margin:6px 0}
th,td{border:1px solid #30363d;padding:4px 8px;text-align:left;vertical-align:top}
th{background:#161b22;color:#c9d1d9;font-weight:600}
th.grp{text-align:center}
td.ok{background:#12261a;color:#7ee787}td.bad{background:#3a1416;color:#ffa198}td.warn{background:#3a2a0c;color:#e3b341}
td.n{color:#8b949e}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dim{color:#8b949e}
.note{border-left:3px solid #388bfd;padding:6px 10px;margin:10px 0 0;color:#c9d1d9;font-size:13px;background:#0f1824;max-width:1180px}
.note.red{border-color:#f85149;background:#1f1214}
.note.green{border-color:#3fb950;background:#0f1d14}
.bars{display:flex;gap:2px;align-items:flex-end;height:70px;border-bottom:1px solid #30363d;margin:4px 0 2px}
.bars div{width:12px;background:#f85149;border-radius:2px 2px 0 0}
.bars.head div{background:#3fb950}
.axis{font-size:11px;color:#6e7681;font-family:ui-monospace,monospace;margin-bottom:8px}
.row{display:flex;gap:28px;flex-wrap:wrap}
"""


def page(title, sub, body):
    return (f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>'
            f'<div class="card"><h1>{html.escape(title)}</h1><div class="sub">{sub}</div>{body}</div></body></html>')


def probe_lines(name):
    path = LOGS / f'{name}.log'
    return [line.rstrip() for line in path.read_text(errors='replace').splitlines() if line.startswith('PROBE')]


def fence_cells(arm):
    cells, release = {}, {}
    for line in probe_lines(f'fence-{arm}'):
        m = re.search(r'PROBE fence phase=(\S+) status=(\S+) route=(\S+) row_status=(\S+) outcome=(.*?) '
                      r'runtime_bindings=(\S+) binding_state=(\[.*?\]) worker_processes=(\d+)->(\d+)', line)
        if m:
            cells[(m.group(1), m.group(2), m.group(3))] = dict(row=m.group(4), outcome=m.group(5),
                                                                bindings=m.group(6), state=m.group(7),
                                                                spawned=int(m.group(9)) - int(m.group(8)))
        m = re.search(r'PROBE release phase=(\S+) session=(\S+) row_status=(\S+) release=(.*?) '
                      r'runtime_session_state=(\S+)', line)
        if m:
            release[(m.group(1), m.group(2))] = dict(row=m.group(3), outcome=m.group(4), state=m.group(5))
    return cells, release


def fig_fence():
    data = {arm: fence_cells(arm) for arm, _, _ in ARMS}
    routes = [('warm_java', 'warm<br>(Java)'), ('warm_http', 'warm<br>(HTTP)'), ('acquire_http', 'acquire<br>(HTTP)')]
    head = '<tr><th rowspan="2">phase · persisted status</th>' + ''.join(
        f'<th class="grp" colspan="3">{html.escape(label)}<br><span class="dim">{html.escape(note)}</span></th>'
        for _, label, note in ARMS) + '</tr><tr>' + ''.join(
        f'<th>{r}</th>' for _ in ARMS for _, r in routes) + '</tr>'
    rows = []
    totals = {arm: 0 for arm, _, _ in ARMS}
    for phase in ['same-process', 'after-restart']:
        for status in ['active', 'closing', 'closed', 'archived', 'deleted']:
            tds = []
            for arm, _, _ in ARMS:
                for route, _ in routes:
                    c = data[arm][0].get((phase, status, route))
                    if c is None:
                        tds.append('<td class="n">n/a</td>')
                        continue
                    started = c['outcome'].startswith('OK')
                    if started:
                        text = f'worker +{c["spawned"]}<br>{c["state"].strip("[]")}'
                        cls = 'ok' if status == 'active' else 'bad'
                        if status != 'active':
                            totals[arm] += 1
                    else:
                        code = c['outcome'].split()[1] if c['outcome'].startswith('REFUSED') else '?'
                        text = f'{code} refused'
                        cls = 'bad' if status == 'active' else 'ok'
                    tds.append(f'<td class="{cls} mono">{text}</td>')
            label = f'{phase} · <b>{status.upper()}</b>'
            rows.append(f'<tr><td>{label}</td>{"".join(tds)}</tr>')
    tot = '<tr><td><b>closed-lifecycle cells that started a worker</b></td>' + ''.join(
        f'<td colspan="3" class="{"bad" if totals[a] else "ok"} mono" style="text-align:center">{totals[a]} / 24</td>'
        for a, _, _ in ARMS) + '</tr>'
    table = f'<table>{head}{"".join(rows)}{tot}</table>'

    rel_rows = []
    for phase, status in [('same-process', 'closing'), ('same-process', 'closed'), ('after-restart', 'active'),
                          ('after-restart', 'closing'), ('after-restart', 'closed')]:
        tds = []
        for arm, _, _ in ARMS:
            r = data[arm][1][(phase, status)]
            if r['outcome'].startswith('OK'):
                tds.append(f'<td class="ok mono">200 released<br><span class="dim">{r["state"]}</span></td>')
            else:
                parts = r['outcome'].split()
                retry = parts[3].split('=')[1] if len(parts) > 3 else '?'
                cls = 'warn' if retry == 'true' else 'bad'
                tds.append(f'<td class="{cls} mono">{parts[1]} {html.escape(parts[2])}<br>retryable={retry}'
                           f' <span class="dim">· {r["state"]}</span></td>')
        rel_rows.append(f'<tr><td>{phase} · <b>{status.upper()}</b></td>{"".join(tds)}</tr>')
    rel = ('<table><tr><th>release over HTTP (Runtime Session acquired while ACTIVE)</th>'
           + ''.join(f'<th>{html.escape(label)}</th>' for _, label, _ in ARMS) + '</tr>' + ''.join(rel_rows)
           + '</table>')
    body = (table
            + '<div class="note">Real <span class="mono">ManagedAgentServerApplication</span> on file H2, embedded '
              'Runtime Broker with the <b>local-process</b> provisioner and the CLI bundled from this head as the '
              'worker (the PR touches no TypeScript, so one bundle serves both arms). Lifecycle goes through the '
              'public API (CLOSING is set on the row). Each cell is a fresh unbound Session. '
              '<span class="mono">worker +1</span> = the call returned 200, wrote a READY Runtime binding and a new '
              'worker process appeared. "after restart" = a second application context on the same database.</div>'
            + '<div class="note green"><b>head:</b> the F1 fix is in — <span class="mono">tool-sessions:acquire</span>'
              ' now joins warm behind the admission resolve: all 24 closed-lifecycle cells refuse with '
              '<span class="mono">409 runtime_broker_session_closed</span> and no worker starts. On base every one '
              'of them provisions a READY Runtime after a restart.</div>'
            + '<h2>Release after a restart (R3-4: the PR body says head returns 409 terminal)</h2>' + rel
            + '<div class="note">After a restart release answers <b>503 runtime_reconciliation_required, '
              'retryable</b> on base and head alike. Only the round-2 head answered 409 terminal, which is the '
              'R2-1 teardown deadlock round 3 removed. The body bullet still describes the round-2 head.</div>')
    (OUT / 'r4-fig1-fence.html').write_text(page(
        'PR #13330 R4 · admission fence by route, before and after a restart',
        'Broker routes that can start Runtime work, base vs head. Green = what the fence should do.', body))


def fig_operability():
    def grab(arm, pattern, source='oper'):
        for line in probe_lines(f'{source}-{arm}'):
            m = re.search(pattern, line)
            if m:
                return m
        return None

    def bars(arm):
        m = grab(arm, r'warns_per_second=\[([0-9,]+)\] total_40s=(\d+) stack_traces=(\d+) defer_warns=(\d+) '
                      r'progress_row_writes_40s=(\d+)')
        series = [int(x) for x in m.group(1).split(',')]
        top = max(10, max(series))
        divs = ''.join(f'<div style="height:{max(1, round(v / top * 66))}px" title="{v}"></div>' for v in series)
        return series, m, f'<div class="bars {"head" if arm == "head" else ""}">{divs}</div>'

    bs, bm, bbar = bars('base')
    hs, hm, hbar = bars('head')
    mat = (f'<div class="row"><div><b>base ba8615f4</b> · {bm.group(2)} WARN lines in 40 s '
           f'<span class="dim">({bm.group(3)} stack frames)</span>{bbar}<div class="axis">1 s buckets, 0–40 s</div></div>'
           f'<div><b>head 51a87ac9</b> · {hm.group(2)} WARN lines in 40 s '
           f'<span class="dim">({hm.group(3)} stack frames, {hm.group(5)} progress-row writes)</span>{hbar}'
           f'<div class="axis">1 s buckets, 0–40 s</div></div></div>')
    rows = []
    for label, pattern, fmt in [
        ('33 poisoned + 1 healthy: healthy event materialized after', r'healthy_event_materialized_after_ms=(.*)$',
         lambda m: m.group(1) + ('' if 'NEVER' in m.group(1) else ' ms')),
        ('32 poisoned (window exactly full): progress-row writes / s', r'poisoned=32 .*progress_writes_per_s=(\d+) '
         r'warns_10s=(\d+)', lambda m: f'{m.group(1)} writes/s · {m.group(2)} WARN / 10 s'),
        ('33 poisoned (window saturated): progress-row writes / s', r'poisoned=33 .*progress_writes_per_s=(\d+) '
         r'warns_10s=(\d+)', lambda m: f'{m.group(1)} writes/s · {m.group(2)} WARN / 10 s'),
        ('materializer stalled 25 s on a row lock: thread', r'row_lock_held_25s materializer_thread=(\S+)',
         lambda m: m.group(1)),
        ('… a 100 ms job on the default scheduler: ticks / max gap',
         r'row_lock_held_25s .* max_gap_ms=(\d+) ticks=(\d+)', lambda m: f'{m.group(2)} / 250 ticks · max gap '
                                                                         f'{m.group(1)} ms')]:
        b, h = grab('base', pattern), grab('head', pattern)
        bt, ht = fmt(b), fmt(h)
        bcls = 'bad' if ('NEVER' in bt or 'scheduling' in bt or 'gap 10' in bt or 'WARN / 10 s' in bt
                         and int(re.search(r'(\d+) WARN', bt).group(1)) > 500) else 'n'
        hcls = 'ok' if bcls == 'bad' else 'n'
        if 'writes/s' in ht and int(ht.split()[0]) > 100:
            hcls = 'warn'
        rows.append(f'<tr><td>{label}</td><td class="{bcls} mono">{html.escape(bt)}</td>'
                    f'<td class="{hcls} mono">{html.escape(ht)}</td></tr>')
    mat_table = ('<table><tr><th>materializer probe</th><th>base ba8615f4</th><th>head 51a87ac9</th></tr>'
                 + ''.join(rows) + '</table>')

    def startup(arm):
        res = {}
        for line in probe_lines(f'startup-{arm}'):
            m = re.search(r'config=(\S+) -> (STARTED|REFUSED TO START: (.*))', line)
            if m:
                res[m.group(1)] = 'STARTED' if m.group(2).startswith('STARTED') else 'refused'
                if m.group(1) == 'kubernetes_provisioner' and m.group(3):
                    res['k8s_msg'] = m.group(3)
                if 'rename_warn' in line:
                    res[m.group(1) + '_rename'] = line
        return res

    sb, sh = startup('base'), startup('head')
    labels = [('base_url_schemeless', 'base URL localhost:4170', False), ('base_url_empty', 'base URL ""', False),
              ('base_url_ftp', 'base URL ftp://host:21', False),
              ('base_url_no_host', 'base URL http://<no host> (main-side guard)', False),
              ('base_url_userinfo', 'base URL http://user:pw@host', False),
              ('base_url_query', 'base URL …/?q=1', False), ('base_url_fragment', 'base URL …/#frag', False),
              ('base_url_upper_scheme', 'base URL HTTP://127.0.0.1:p', True),
              ('lease_renew_0s', 'renew 0s', False), ('lease_renew_999us', 'renew 999us', False),
              ('lease_renew_minus_1s', 'renew -1s', False), ('lease_lease20s_renew20s', 'lease 20s · renew 20s', False),
              ('lease_lease60s_renew31s', 'lease 60s · renew 31s (> half)', False),
              ('lease_lease60s_renew30s', 'lease 60s · renew 30s (exactly half)', True),
              ('lease_lease2s_renew500ms_e2e', 'lease 2s · renew 500ms (e2e runner)', True),
              ('lease_defaults_60s_20s', 'defaults (60s · 20s)', True)]
    srows = []
    for key, label, valid in labels:
        def cell(v):
            good = (v == 'STARTED') == valid
            return f'<td class="{"ok" if good else "bad"} mono">{v}</td>'
        if key == 'lease_lease60s_renew31s':
            srows.append(f'<tr><td class="mono">{html.escape(label)}</td><td class="n mono">{sb[key]}</td>'
                         f'<td class="warn mono">{sh[key]}</td></tr>')
            continue
        srows.append(f'<tr><td class="mono">{html.escape(label)}</td>{cell(sb[key])}{cell(sh[key])}</tr>')
    start_table = ('<table><tr><th>startup config (Hosted Harness enabled)</th><th>base</th><th>head</th></tr>'
                   + ''.join(srows) + '</table>')
    rename = sh['base_url_valid_dead_rename']
    m = re.search(r'first_rename=(HTTP \d+ \S+) server_log_lines=(\d+) rename_warn="(.*?)" cause_in_log=(\S+)', rename)
    rb = re.search(r'first_rename=(HTTP \d+ \S+) server_log_lines=(\d+)', sb['base_url_valid_dead_rename'])
    warn_text = m.group(3).split(':', 1)[-1].strip() if ':' in m.group(3) else m.group(3)
    body = ('<h2>Materializer backoff (one Session whose event sequence has a gap)</h2>' + mat + mat_table
            + '<div class="note">The high writes/s while saturated are the skip-path rotation: every non-due target '
              'in a saturated window gets one <span class="mono">UPDATE … SET updated_at</span> per 100 ms pass. '
              'That is the price of the starvation fix (base starves the healthy Session and floods WARN instead). '
              'Below saturation head writes only after a failed attempt.</div>'
            + '<div class="row"><div><h2>Startup guards</h2>' + start_table + '</div><div><h2>Rename against a dead '
              'Hosted Harness</h2><table><tr><th></th><th>base</th><th>head</th></tr>'
              f'<tr><td>response</td><td class="mono">{rb.group(1)}</td><td class="mono">{m.group(1)}</td></tr>'
              f'<tr><td>server log lines</td><td class="bad mono">{rb.group(2)}</td><td class="ok mono">'
              f'{m.group(2)}</td></tr><tr><td>WARN text</td><td class="mono">—</td><td class="ok mono">'
              f'{html.escape(warn_text[:40])}…</td></tr><tr><td>root cause logged</td><td class="bad mono">false'
              f'</td><td class="ok mono">{m.group(4)}</td></tr></table>'
              f'<h2>Kubernetes provisioner</h2><table><tr><th>base</th><td class="mono">{html.escape(sb["k8s_msg"])}'
              f'</td></tr><tr><th>head</th><td class="ok mono">{html.escape(sh["k8s_msg"])}</td></tr></table>'
              '</div></div>')
    (OUT / 'r4-fig2-operability.html').write_text(page(
        'PR #13330 R4 · operability on the running server',
        'Real ManagedAgentServerApplication on H2. base = ba8615f4, head = 51a87ac9.', body))


def fig_tests(summary):
    (OUT / 'r4-fig3-tests.html').write_text(page(
        'PR #13330 R4 · suites, negative control and mutation sweep', summary['sub'], summary['body']))


if __name__ == '__main__':
    import sys
    fig_fence()
    fig_operability()
    if len(sys.argv) > 1:
        fig_tests(json.loads(Path(sys.argv[1]).read_text()))
    print('ok', sorted(p.name for p in OUT.iterdir()))
