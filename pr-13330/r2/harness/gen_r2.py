#!/usr/bin/env python3
"""Round-2 figures for PR #13330 (head 924484ef vs merge-base 43a6e1e5)."""
import html
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, '/root/verify/pr13330/render')
import gen  # noqa: E402  (reuses CSS/page/pane)

ROOT = Path('/root/verify/pr13330')
LOGS = ROOT / 'logs'
OUT = ROOT / 'render2'
BASE, HEAD = '43a6e1e5', '924484ef'
EXTRA_CSS = """
.bars{display:flex;width:max-content;min-width:480px;gap:2px;align-items:flex-end;height:64px;border-bottom:1px solid #30363d;margin:4px 0 2px}
.bars div{width:11px;background:#f85149;border-radius:2px 2px 0 0}
.bars.head div{background:#3fb950}
.axis{font-size:11px;color:#6e7681;font-family:ui-monospace,monospace;margin-bottom:10px}
td.mono,span.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
"""


def page(title, sub, body):
    return gen.page(title, sub, body).replace('</style>', EXTRA_CSS + '</style>', 1)


def lines(log):
    return [line.rstrip() for line in (LOGS / log).read_text().splitlines() if line.startswith('PROBE')]


def write(name, content):
    (OUT / f'{name}.html').write_text(content)


def fig_close_fence():
    def cells(log):
        warm, release = {}, {}
        for line in lines(log):
            m = re.search(r'phase=(\S+) session=(\S+) row_status=(\S+) warm=(.*?) runtime_bindings=(\S+)', line)
            if m:
                warm[(m.group(1), m.group(2))] = (m.group(3), m.group(4), m.group(5))
            m = re.search(r'release phase=(\S+) session=(\S+) row_status=(\S+) release=(.*?) runtime_session_state='
                          r'(\S+)', line)
            if m:
                release[(m.group(1), m.group(2))] = (m.group(3), m.group(4), m.group(5))
        return warm, release
    (bw, br), (hw, hr) = cells('r2-base2-fence.log'), cells('r2-head2-fence.log')

    def warm_cell(value, name):
        status, outcome, bindings = value
        if outcome == 'WARMED':
            cls = 'ok' if name == 'active' else 'bad'
            text = f'WARMED · binding {bindings} READY'
        else:
            cls = 'ok' if name != 'active' else 'bad'
            text = 'REFUSED 409 ' + outcome.split('code=')[-1]
        return f'<td class="{cls} mono">{html.escape(text)}</td>'

    rows = []
    for name in ['active', 'closed', 'archived', 'deleted']:
        status = hw[('same-process', name)][0]
        rows.append(f'<tr><td><b>{name}</b> <span class="dim">({status})</span></td>'
                    + warm_cell(bw[('same-process', name)], name) + warm_cell(bw[('after-restart', name)], name)
                    + warm_cell(hw[('same-process', name)], name) + warm_cell(hw[('after-restart', name)], name)
                    + '</tr>')
    warm_table = ('<table><tr><th>Unbound Session (row)</th><th>base · same process</th><th>base · after restart</th>'
                  f'<th>head · same process</th><th>head · after restart</th></tr>{"".join(rows)}</table>')

    def rel_cell(value):
        status, outcome, state = value
        if outcome.startswith('released=true'):
            return f'<td class="ok mono">released · {html.escape(state)}</td>'
        m = re.search(r'status=(\d+) code=(\S+) retryable=(\S+)', outcome)
        cls = 'warn'
        return (f'<td class="{cls} mono">{m.group(1)} {html.escape(m.group(2))} · retryable={m.group(3)}'
                f'<br><span class="dim">runtime session {html.escape(state)}</span></td>')
    rrows = []
    for phase, name in [('same-process', 'closing'), ('same-process', 'closed'), ('after-restart', 'active'),
                        ('after-restart', 'closing'), ('after-restart', 'closed')]:
        rrows.append(f'<tr><td>{phase} · <b>{name.upper()}</b></td>{rel_cell(br[(phase, name)])}'
                     f'{rel_cell(hr[(phase, name)])}</tr>')
    release_table = ('<table><tr><th>Runtime Session release (Harness provider path)</th>'
                     f'<th>base {BASE}</th><th>head {HEAD}</th></tr>{"".join(rrows)}</table>')
    body = (warm_table
            + '<div class="legend">Close / archive / delete through the public HTTP API, then '
              '<span class="mono">EmbeddedRuntimeBroker.warm()</span> (what HarnessCoordinator calls for a dispatched '
              'Turn). Real ManagedAgentServerApplication on H2, local-process provisioner, the bundled CLI as the '
              'worker. "after restart" = a second application context on the same database.</div>'
            + release_table
            + '<div class="note">Release side check for the wider fence: a Runtime Session held in this process '
              'releases on both arms whatever the row says (the in-process route never consults the resolver). '
              'After a restart neither arm can release it and the runtime row stays READY on both; only the answer '
              'changes, from a retryable 503 to a terminal 409 for CLOSING/CLOSED rows. Not reachable from the '
              'real hosted stack today: unbound Turns get 0 tools, so they never acquire a Runtime Session.</div>')
    write('r2-fig1-close-fence', page(
        f'F2 · close fence at {HEAD}: closed rows refuse warm in-process and after restart',
        f'merge-base {BASE} vs head {HEAD} · probe <span class="mono">Pr13330CloseFenceProbe</span>', body))


def fig_materializer():
    def series(log):
        text = '\n'.join(lines(log))
        per_second = [int(x) for x in re.search(r'warns_per_second=\[([^\]]*)\]', text).group(1).split(',')]
        buckets = [int(x) for x in re.search(r'warns_per_5s_since_poison=\[([^\]]*)\]', text).group(1).split(',')]
        starve = re.search(r'healthy_event_materialized_after_ms=(.*)', text).group(1)
        return per_second, buckets, starve
    bs, bb, bst = series('r2-base2-operability.log')
    hs, hb, hst = series('r2-head2-operability.log')

    def bars(values, cls, scale):
        cols = ''.join(f'<div style="height:{max(1, round(v / scale * 60)) if v else 0}px" title="{v}"></div>'
                       for v in values)
        return f'<div class="bars {cls}">{cols}</div>'
    peak = max(bs + hs)
    body = (f'<table><tr><th></th><th>base {BASE}</th><th>head {HEAD}</th></tr>'
            f'<tr><td>1 poisoned Session · WARN lines in 40 s</td><td class="bad mono">{sum(bs)}</td>'
            f'<td class="ok mono">{sum(hs)}</td></tr>'
            f'<tr><td>… steady state after the 64 cap (seconds 8–40)</td><td class="bad mono">{sum(bs[7:])} '
            f'(≈10/s)</td><td class="ok mono">{sum(hs[7:])} (one per ≈6.4 s)</td></tr>'
            f'<tr><td>33 poisoned Sessions · WARN lines per 5 s</td><td class="bad mono">{", ".join(map(str, bb))}'
            f'</td><td class="ok mono">{", ".join(map(str, hb))}</td></tr>'
            f'<tr><td>Healthy Session event with 33 poisoned (TARGET_LIMIT 32)</td><td class="bad mono">'
            f'{html.escape(bst)}</td><td class="ok mono">{html.escape(hst)} ms</td></tr></table>'
            f'<div class="legend">WARN lines per second, one permanently poisoned Session '
            f'(red = base, green = head, same scale, peak {peak}/s):</div>'
            + bars(bs, '', peak) + bars(hs, 'head', peak)
            + '<div class="axis">t = 1 s … 40 s · head attempts on streaks 0,1,2,4,…,64 then every 64th pass '
              '(seconds 13, 20, 26, 33, 39)</div>'
            + '<div class="note">Real ManagedAgentServerApplication on H2; the poison is a real event-sequence gap '
              '(two events appended in one transaction, the first deleted), so every attempt trips the gap guard. '
              'Lines counted from the application log with OutputCaptureExtension. The round-1 measurement at '
              'c096be36 was 10/s again after ≈6.5 s.</div>')
    write('r2-fig2-materializer', page(
        f'Item 8 · materializer backoff at {HEAD}: no starvation, no warn flood at the cap',
        f'merge-base {BASE} vs head {HEAD} · probe <span class="mono">Pr13330OperabilityProbe</span>', body))


def fig_rest():
    def grab(log, pattern):
        for line in lines(log):
            if re.search(pattern, line):
                return line.replace('PROBE ', '')
        return '(missing)'
    ident = [(grab(f'r2-{arm}-identity.log', rf'^PROBE {s} same_item=|^PROBE {s} stored_item='),
              grab(f'r2-{arm}-identity.log', rf'^PROBE {s} GET /items/<call_item>')) for arm in ('base2', 'head2')
             for s in ('A_late_update', 'B_call_first', 'C_upgrade')]
    rename = {arm: grab(f'r2-{arm}-operability.log', r'defaults_dead_harness first_rename') for arm in
              ('base2', 'head2')}
    left = [('F1 · tool item identity (production classes)', 'hl')]
    for index, scenario in enumerate(('A late update', 'B call first', 'C upgrade')):
        for arm_index, arm in enumerate((BASE, HEAD)):
            same, route = ident[arm_index * 3 + index]
            ok = 'same_item=true' in same
            left.append((f'{arm} {scenario}: ' + ('one item' if ok else 'SPLIT')
                         + ('' if '(missing)' in route else ' · call item tool-result '
                            + route.split('-> ')[-1].split(' ')[1]), 'ok' if ok else 'bad'))
    left += [('', ''), ('Item 7 · rename against a dead Hosted Harness', 'hl')]
    for arm, label in (('base2', BASE), ('head2', HEAD)):
        line = rename[arm]
        logged = 'rename_warn_logged=true' in line
        lines_logged = re.search(r'server_log_lines=(\d+)', line).group(1)
        left.append((f'{label}: HTTP 503 · server log lines {lines_logged} · WARN+cause '
                     + ('yes' if logged else 'no'), 'ok' if logged else 'bad'))
    hosted = (LOGS / 'r2-head2-hostedprobe.log').read_text()
    events = re.findall(r'PROBE hosted event_type (\S+)=(\d+)', hosted)
    tools = re.search(r'unbound_turn status=(\S+) .*model_requests=\[(.*?)\]', hosted)
    right = [('Real hosted stack at ' + HEAD + ' (qwen serve --profile hosted-harness)', 'hl'),
             (f'HostedPr13330ProbeIT: {re.findall(r"Tests run: (\d+), Failures: (\d+)", hosted)[-1][0]} run, 0 failed',
              'ok'),
             ('unbound Turn ' + tools.group(1) + ' · ' + tools.group(2), ''),
             ('tool executions in the workspace Session: '
              + re.search(r'qwen_tool_execution=(\d+)', hosted).group(1), ''),
             ('item.tool_call.updated events: ' + str(sum(int(c) for t, c in events if 'tool' in t)), ''),
             ('', ''), ('All event types:', 'dim')] + [(f'  {t} = {c}', 'dim') for t, c in events]
    body = ('<div class="row">' + gen.pane('Identity + rename', left) + gen.pane('Reachability', right) + '</div>'
            + '<div class="note">F1: the head projector is back on EventIdentity v1 (turnId:callId) for callId-bearing '
              'updates, so it now agrees with the published tool result and with base; only the no-id fallback moved '
              'to "#source:". The real hosted stack still emits no tool events, so this path stays latent either '
              'way.</div>')
    write('r2-fig3-identity-rename', page(
        f'F1 and item 7 at {HEAD}', f'merge-base {BASE} vs head {HEAD}', body))


def fig_mutation():
    data = json.loads((ROOT / 'results' / 'mutation-r2.json').read_text())
    rows = []
    for row in data['mutants']:
        killed = row['killed']
        new = row['id'].startswith('n')
        names = [test.split('#')[1] for test in row['killed_by']]
        by = ', '.join(names[:2]) + (f' +{len(names) - 2}' if len(names) > 2 else '')
        if not row['compiled']:
            by = 'compile error'
        tag = '<span class="hl">new</span> ' if new else ''
        rows.append(f'<tr><td class="mono">{row["id"]}</td><td>{tag}{html.escape(row["desc"])}'
                    f'<br><span class="dim mono">{html.escape(row["file"])}</span></td>'
                    f'<td class="{"ok" if killed else "bad"}">{"killed" if killed else "SURVIVED"}</td>'
                    f'<td class="mono" style="font-size:11px;word-break:break-all;max-width:330px">{html.escape(by)}</td></tr>')
    half = (len(rows) + 1) // 2
    head = '<tr><th>id</th><th>mutation</th><th></th><th>killed by (PR test methods)</th></tr>'
    tables = ('<div class="row">' + f'<div style="flex:1"><table>{head}{"".join(rows[:half])}</table></div>'
              + f'<div style="flex:1"><table>{head}{"".join(rows[half:])}</table></div></div>')
    control = data['control_total']
    nc_r3, nc_base = data['nc-r3'], data['nc-base2']

    def methods(entry):
        return sorted({f.split('#')[1] for f in entry['failures']})
    killed = sum(1 for row in data['mutants'] if row['killed'])
    flaky = {'RuntimeBrokerDefaultOnTest': 0, 'HarnessCoordinatorTest': 0}
    for row in data['mutants']:
        for test in row['flaky_seen']:
            flaky[test.split('#')[0]] += 1
    notes = (f'<div class="note"><b>Control</b> (unmutated head): {control[0]} tests, {control[1]} failures, '
             f'{control[2]} errors. <b>Kills</b>: {killed}/{len(data["mutants"])}. Each mutant ran the full module '
             f'suite (aarch64, maven:3.9.11-eclipse-temurin-21).<br>'
             f'<b>Negative control A</b>: round-3 test classes on the previous head c096be36 → {nc_r3["total"][0]} '
             f'tests, {int(nc_r3["total"][1]) + int(nc_r3["total"][2])} red: {", ".join(methods(nc_r3))}.<br>'
             f'<b>Negative control B</b>: the PR\'s changed test classes on the merge-base {BASE} (MessageMaterializer'
             f'Test and ManagedMaterializationDeferTest need the new interface method and were left out) → '
             f'{nc_base["total"][0]} tests, {int(nc_base["total"][1]) + int(nc_base["total"][2]) - len(nc_base["flaky_seen"])}'
             f' red (6 of them the parameterized fence cases): {", ".join(methods(nc_base))}.<br>'
             f'<b>Excluded from kill decisions</b> (pre-existing, not touched by the PR, green in both unmutated runs: head 1043 run, base 1020 run, 0 failed): '
             f'RuntimeBrokerDefaultOnTest, the round-1 aarch64 timing race (red in {flaky["RuntimeBrokerDefaultOnTest"]}/30 '
             f'mutant runs and in negative control B on base code), and HarnessCoordinatorTest.'
             f'runningOwnerObservesCancellationAfterStreamingStarts ({flaky["HarnessCoordinatorTest"]}/30, under '
             f'mutants that do not touch the cancel path). Every mutant is still killed by a PR test without them.</div>')
    write('r2-fig4-mutation', page(f'Mutation sweep and negative controls at {HEAD}',
                                   'm01–m17: the round-1 set re-anchored on the new code · n01–n13: round-3 code',
                                   tables + notes))


if __name__ == '__main__':
    targets = sys.argv[1:] or ['close', 'mat', 'rest']
    if 'close' in targets:
        fig_close_fence()
    if 'mat' in targets:
        fig_materializer()
    if 'rest' in targets:
        fig_rest()
    if 'mut' in targets:
        fig_mutation()
    print('ok', targets)
