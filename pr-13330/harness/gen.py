#!/usr/bin/env python3
"""Builds the PR #13330 verification figures from the raw probe logs."""
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path('/root/verify/pr13330')
LOGS = ROOT / 'logs'
OUT = ROOT / 'render'
BASE = '3172c9fd'
HEAD = 'c096be36'

CSS = """
body{margin:0;background:#0b0f14;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif}
.card{display:inline-block;margin:20px;padding:22px 26px;background:#0d1117;border:1px solid #30363d;border-radius:10px;color:#d0d7de;max-width:1500px}
h1{font-size:20px;margin:0 0 4px;color:#f0f6fc}
.sub{font-size:13px;color:#8b949e;margin-bottom:16px;line-height:1.45}
.row{display:flex;gap:16px;align-items:flex-start}
.pane{flex:1;background:#010409;border:1px solid #30363d;border-radius:8px;padding:10px 12px;min-width:0}
.pane h2{font-size:13px;margin:0 0 8px;color:#8b949e;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
pre{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-all}
.ok{color:#3fb950}.bad{color:#f85149;font-weight:600}.warn{color:#d29922}.dim{color:#6e7681}.hl{color:#79c0ff}
table{border-collapse:collapse;font-size:13px;margin-bottom:14px}
th,td{border:1px solid #30363d;padding:6px 10px;text-align:left;vertical-align:top}
th{background:#161b22;color:#c9d1d9}
td.ok{background:rgba(63,185,80,.12)}td.bad{background:rgba(248,81,73,.15)}td.warn{background:rgba(210,153,34,.13)}
.note{font-size:12px;color:#8b949e;margin-top:12px;line-height:1.45}
.legend{font-size:12px;color:#8b949e;margin:4px 0 10px}
"""


def page(title, sub, body):
    return (f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>'
            f'<div class="card"><h1>{html.escape(title)}</h1><div class="sub">{sub}</div>{body}</div></body></html>')


def pane(title, lines):
    rows = []
    for text, cls in lines:
        rows.append(f'<span class="{cls}">{html.escape(text)}</span>' if cls else html.escape(text))
    return f'<div class="pane"><h2>{html.escape(title)}</h2><pre>{chr(10).join(rows)}</pre></div>'


def probe_lines(log, prefix='PROBE'):
    return [line.rstrip() for line in (LOGS / log).read_text().splitlines() if line.startswith(prefix)]


def classify(line, bad=(), ok=(), warn=()):
    for pattern in bad:
        if re.search(pattern, line):
            return 'bad'
    for pattern in warn:
        if re.search(pattern, line):
            return 'warn'
    for pattern in ok:
        if re.search(pattern, line):
            return 'ok'
    return ''


def write(name, content):
    (OUT / f'{name}.html').write_text(content)


# ---------------------------------------------------------------- fig1: F2
def fig1():
    def cells(log):
        result = {}
        for line in probe_lines(log):
            m = re.search(r'phase=(\S+) session=(\S+) row_status=(\S+) warm=(.*?) runtime_bindings=(\S+)', line)
            if m:
                result[(m.group(1), m.group(2))] = (m.group(3), m.group(4), m.group(5))
        return result
    base, head = cells('f2-base.log'), cells('f2-head.log')
    header = ('<tr><th>Session (row status)</th><th>base · same process</th><th>base · after restart</th>'
              '<th>head · same process</th><th>head · after restart</th></tr>')
    rows = []
    for name in ['active', 'closed', 'archived', 'deleted']:
        tds = []
        for arm in (base, head):
            for phase in ('same-process', 'after-restart'):
                status, outcome, bindings = arm[(phase, name)]
                if outcome == 'WARMED':
                    cls = 'ok' if name == 'active' else 'bad'
                    text = f'WARMED · runtime binding {bindings} (READY)'
                else:
                    cls = 'ok'
                    text = outcome.replace('REFUSED code=', 'refused: ')
                tds.append(f'<td class="{cls}">{html.escape(text)}</td>')
        rows.append(f'<tr><th>{name} ({base[("same-process", name)][0]})</th>{"".join(tds)}</tr>')
    table = f'<table>{header}{"".join(rows)}</table>'

    def lines(log):
        out = []
        for line in probe_lines(log):
            line = line.replace('PROBE ', '')
            out.append((line, classify(line, bad=[r'session=(closed|archived|deleted).*warm=WARMED'],
                                       ok=[r'REFUSED', r'in_process_retired=true'],
                                       warn=[r'session=(closed|archived|deleted).*in_process_retired=false'])))
        return out
    body = (table + '<div class="row">' + pane(f'base {BASE} — Pr13330CloseFenceProbe', lines('f2-base.log'))
            + pane(f'head {HEAD} — Pr13330CloseFenceProbe', lines('f2-head.log')) + '</div>'
            + '<div class="note">Each warm() is the call HarnessCoordinator.warmRuntime makes for a dispatched Turn. '
              'Red = the broker provisioned a real local-process Runtime worker (qwen_runtime_binding READY) for a '
              'Session whose row is not ACTIVE. "after restart" = lifecycle in one JVM, warm in a fresh '
              'ManagedAgentServerApplication on the same H2 file database.</div>')
    write('fig1-close-fence', page(
        'Finding 2 — the close path loses its retirement fence',
        'Real <b>ManagedAgentServerApplication</b> (JDK 21, H2 file DB) · unbound Sessions closed / archived / deleted '
        'through the public HTTP API · embedded Runtime Broker with the <b>local-process</b> provisioner '
        '(bundled CLI as worker) · then <code>EmbeddedRuntimeBroker.warm(sessionId)</code>', body))


# ---------------------------------------------------------------- fig2: F1
def fig2():
    def lines(log):
        out = []
        for line in probe_lines(log):
            line = line.replace('PROBE ', '')
            if 'stored_tool_call_data' in line:
                continue
            out.append((line, classify(line, bad=[r'same_item=false', r'HTTP 404', r'public_items=2',
                                                   r'C_upgrade public_item .*status=in_progress'],
                                       ok=[r'same_item=true', r'HTTP 200', r'public_items=1'])))
        order = {'A_': 0, 'B_': 1, 'C_': 2}
        return sorted(out, key=lambda item: order.get(item[0][:2], 3))
    body = ('<div class="row">' + pane(f'base {BASE} — Pr13330ToolItemIdentityProbe', lines('f1-base.log'))
            + pane(f'head {HEAD} — Pr13330ToolItemIdentityProbe', lines('f1-head.log')) + '</div>'
            + '<div class="note">A = a late harness tool_call_update after the published result; '
              'B = production order (harness tool_call first, then the Session Store publication is projected by '
              'ManagedToolResultProjector); C = a Turn in flight across the upgrade (tool_call stored by the base '
              'build, verbatim, then tool_call_update projected by the running build). Items are read through '
              'ManagedAgentService.listPublicItems (the GET /items service) after the snapshot converges; '
              'tool-result through the real ManagedArtifactController.</div>')
    write('fig2-tool-item-identity', page(
        'Finding 1 — tool-call item id and published-result item id diverge',
        'Production <b>HarnessEventProjector</b> + <b>ManagedToolResultProjector</b> + <b>ManagedAgentStore</b> on H2, '
        'reusing <code>ToolPublicationStoreTest.apiFixture()</code> (a real committed shell publication for '
        '<code>modelCallId=model-1</code>)', body))


# ---------------------------------------------------------------- fig3: reachability
def fig3():
    def lines(log):
        out = []
        for line in probe_lines(log, 'PROBE hosted'):
            line = line.replace('PROBE hosted ', '')
            if line.startswith(('harness_log_tail', 'model_failure', 'unbound_event environment', 'unbound_turn row')):
                continue
            line = line if len(line) < 190 else line[:187] + '...'
            out.append((line, classify(line, ok=[r'COMPLETED'], warn=[r'qwen_tool_publication=0',
                                                                     r'managed_agent_tool_result=0',
                                                                     r'tools=0', r'qwen_tool_execution=12'])))
        return out
    body = ('<div class="row">' + pane(f'base {BASE} — HostedPr13330ProbeIT', lines('it-base.log'))
            + pane(f'head {HEAD} — HostedPr13330ProbeIT', lines('it-head.log')) + '</div>'
            + '<div class="note">Copy of HostedPublicWorkspaceIT#publicCreationRunsFilesThroughProductionWorkspaceBinding '
              '(real <code>qwen serve --profile hosted-harness</code> from the bundled CLI, real Session Store, Runtime '
              'Broker and workspace mounts, fake OpenAI model) plus one unbound Session turn. Both arms: 12 Workspace '
              'tool executions but <b>no item.tool_call.updated event</b> on the public stream, <b>no publication</b>, '
              'and the unbound Session is offered <b>0 tools</b> — HarnessEventProjector\'s tool branch is not reached '
              'by the hosted stack at this head, so Finding 1 is latent today.</div>')
    write('fig3-reachability', page(
        'Finding 1 reachability — real Hosted Harness full stack',
        'Spring server + real Hosted Harness daemon + embedded Runtime Broker (local-process) + H2 · '
        'same CLI bundle for both arms', body))


# ---------------------------------------------------------------- fig4: operability
def fig4():
    def parse(log):
        data = {'startup': {}, 'rename': {}}
        for line in probe_lines(log):
            m = re.match(r'PROBE startup config=(\S+) -> (.*)', line)
            if m:
                data['startup'][m.group(1)] = m.group(2)
            m = re.match(r'PROBE startup config=(\S+) first_rename -> (.*)', line)
            if m:
                data['rename'][m.group(1)] = m.group(2)
            m = re.search(r'warns_per_second=\[([0-9,]+)\] total_20s=(\d+)', line)
            if m:
                data['series'] = [int(x) for x in m.group(1).split(',')]
                data['total'] = int(m.group(2))
            m = re.search(r'healthy_event_materialized_after_ms=(.*)', line)
            if m:
                data['starve'] = m.group(1)
        return data
    base, head = parse('ops-base.log'), parse('ops-head.log')
    rows = []
    labels = {
        'schemeless_base_url': 'harness.base-url=localhost:4170',
        'empty_base_url': 'harness.base-url= (empty)',
        'zero_renew': 'dispatch.lease-renew-interval=0s',
        'renew_equals_lease': 'lease-duration=20s, renew=20s',
        'kubernetes_provisioner': 'runtime-broker.provisioner=kubernetes',
        'defaults_dead_harness': 'valid config, Hosted Harness down',
    }
    for key, label in labels.items():
        cells = []
        for arm in (base, head):
            start = arm['startup'].get(key, '')
            rename = arm['rename'].get(key)
            text = start + (f' → first PATCH rename: {rename}' if rename else '')
            if key == 'defaults_dead_harness':
                cls = 'warn'
            elif key == 'kubernetes_provisioner':
                cls = 'ok' if 'not supported' in start else 'warn'
            else:
                cls = 'ok' if 'REFUSED' in start else 'bad'
            cells.append(f'<td class="{cls}">{html.escape(text)}</td>')
        rows.append(f'<tr><th>{html.escape(label)}</th>{"".join(cells)}</tr>')
    table = ('<table><tr><th>Config / scenario</th><th>base ' + BASE + '</th><th>head ' + HEAD + '</th></tr>'
             + ''.join(rows)
             + f'<tr><th>33 poisoned Sessions + 1 healthy Session gets a new event</th>'
               f'<td class="bad">healthy event materialized after: {html.escape(base["starve"])}</td>'
               f'<td class="ok">healthy event materialized after: {html.escape(head["starve"])} ms</td></tr></table>')

    def bars(series, color):
        w, h, gap = 26, 120, 4
        svg = [f'<svg width="{len(series) * (w + gap) + 30}" height="{h + 34}" xmlns="http://www.w3.org/2000/svg">']
        for level in (0, 5, 10):
            y = h - level * 10 + 4
            svg.append(f'<line x1="24" x2="{len(series) * (w + gap) + 28}" y1="{y}" y2="{y}" stroke="#30363d"/>'
                       f'<text x="2" y="{y + 4}" fill="#6e7681" font-size="10">{level}</text>')
        for i, v in enumerate(series):
            x = 28 + i * (w + gap)
            svg.append(f'<rect x="{x}" y="{h - v * 10 + 4}" width="{w}" height="{v * 10}" fill="{color}"/>'
                       f'<text x="{x + w / 2}" y="{h + 18}" fill="#8b949e" font-size="10" text-anchor="middle">{i + 1}</text>'
                       f'<text x="{x + w / 2}" y="{h - v * 10}" fill="#c9d1d9" font-size="10" text-anchor="middle">{v}</text>')
        svg.append(f'<text x="28" y="{h + 32}" fill="#6e7681" font-size="10">second after the Session became poisoned</text></svg>')
        return ''.join(svg)
    chart = ('<div class="row">'
             f'<div class="pane"><h2>base {BASE}: WARN "Failed to materialize" per second — total {base["total"]} in 20 s</h2>'
             + bars(base['series'], '#f85149') + '</div>'
             f'<div class="pane"><h2>head {HEAD}: WARN per second — total {head["total"]} in 20 s</h2>'
             + bars(head['series'], '#d29922') + '</div></div>')
    body = (table + chart
            + '<div class="note">Real ManagedAgentServerApplication on H2 with the real @Scheduled MessageMaterializer '
              '(100 ms). A Session is "poisoned" with a real permanent failure (an event-sequence gap that trips the '
              'gap guard on every attempt). Head backs off on streaks 1, 2, 4, 8, 16, 32 and then, once the streak '
              'reaches MAX_BACKOFF_STREAK=64 (~6.5 s), attempts and warns on every pass again — the same 10/s as base. '
              'Rename with a dead Hosted Harness: the 503 now carries the cause, but ApiExceptionHandler never logs '
              'ApiException, so the server writes 0 log lines on both arms.</div>')
    write('fig4-operability', page(
        'Operator-visible items — startup validation, rename 503, materializer backoff',
        'Pr13330OperabilityProbe on both arms (CapturedOutput of the real application log)', body))


if __name__ == '__main__':
    for name in sys.argv[1:] or ['fig1', 'fig2', 'fig3', 'fig4']:
        globals()[name]()
        print('built', name)
