#!/usr/bin/env python3
"""PR #13330 round-4 assertion collector.

Reads the round-4 probe logs (logs/ directory passed as argv[1]) and emits one
PASS/FAIL line per scripted assertion, plus assertions.json. Expectations are
per arm: base = ba8615f4 (main tip, the bug must reproduce — expected failures
count as PASS when they match the documented bug shape), head = 51a87ac9.

Only assertions whose probe output actually ran are counted; a missing probe
line is a FAIL of the harness, not silence.
"""
import json
import re
import sys
from pathlib import Path

LOGS = Path(sys.argv[1])
results = []  # (status, group, name, detail)


def check(ok, group, name, detail):
    results.append(('PASS' if ok else 'FAIL', group, name, detail))


def probe_lines(name):
    path = LOGS / f'{name}.log'
    if not path.exists():
        return None
    return [l.rstrip() for l in path.read_text(errors='replace').splitlines() if l.startswith('PROBE')]


FENCE = re.compile(
    r'PROBE fence phase=(\S+) status=(\S+) route=(\S+) row_status=(\S+) outcome=(.*?) '
    r'runtime_bindings=(\d+)->(\d+) binding_state=(\[.*?\]) worker_processes=(\d+)->(\d+)')
RELEASE = re.compile(
    r'PROBE release phase=(\S+) session=(\S+) row_status=(\S+) release=(.*?) '
    r'runtime_session_state=(\S+)->(\S+)')
RELSETUP = re.compile(r'PROBE release-setup acquire session=\S+ outcome=(.*?) runtime_session_state=(\S+)')
LIFECYCLE = re.compile(r'PROBE lifecycle (\S+) row_status=(\S+)')

CLOSED = ['closing', 'closed', 'archived', 'deleted']
ROUTES = ['warm_java', 'warm_http', 'acquire_http']
PHASES = ['same-process', 'after-restart']


def fence_arm(arm, is_head):
    lines = probe_lines(f'fence-{arm}')
    if lines is None:
        check(False, f'fence-{arm}', 'log exists', 'missing')
        return
    cells, releases, setups, lifecycles = {}, {}, [], {}
    for line in lines:
        m = FENCE.search(line)
        if m:
            cells[(m.group(1), m.group(2), m.group(3))] = m
        m = RELEASE.search(line)
        if m:
            releases[(m.group(1), m.group(2))] = m
        m = RELSETUP.search(line)
        if m:
            setups.append(m)
        m = LIFECYCLE.search(line)
        if m:
            lifecycles[m.group(1)] = m.group(2)
    for key, st in lifecycles.items():
        want = key.split('/')[0].upper()
        check(st == want, f'fence-{arm}', f'lifecycle {key}', f'row_status={st} want={want}')
    for phase in PHASES:
        for status in ['active'] + CLOSED:
            for route in ROUTES:
                c = cells.get((phase, status, route))
                name = f'{phase} {status} {route}'
                if c is None:
                    check(False, f'fence-{arm}', name, 'no probe line')
                    continue
                outcome, b0, b1, spawned = c.group(5), c.group(6), c.group(7), int(c.group(10)) - int(c.group(9))
                if status == 'active':
                    check(outcome.startswith('OK') and b0 == '0' and b1 == '1' and spawned == 1,
                          f'fence-{arm}', name, f'outcome={outcome} bindings={b0}->{b1} workers=+{spawned}')
                elif is_head:
                    ok = (outcome == 'REFUSED 409 runtime_broker_session_closed retryable=false'
                          and b0 == b1 and spawned == 0)
                    check(ok, f'fence-{arm}', name,
                          f'outcome={outcome} bindings={b0}->{b1} workers=+{spawned}')
                else:
                    # base control: the durable bug must reproduce. In-process,
                    # base's volatile fence covers some cells; after a restart nothing is fenced.
                    if phase == 'after-restart':
                        ok = outcome.startswith('OK') and b1 == '1' and spawned == 1
                        check(ok, f'fence-{arm}', name + ' (control: bug reproduces)',
                              f'outcome={outcome} bindings={b0}->{b1} workers=+{spawned}')
    for (phase, name), r in sorted(releases.items()):
        outcome, s0, s1 = r.group(4), r.group(5), r.group(6)
        if phase == 'same-process':
            check(outcome == 'OK 200' and s0 == 'READY' and s1 == 'RELEASED', f'fence-{arm}',
                  f'release {phase} {name}', f'{outcome} {s0}->{s1}')
        else:
            check(outcome == 'REFUSED 503 runtime_reconciliation_required retryable=true'
                  and s0 == 'READY' and s1 == 'READY', f'fence-{arm}',
                  f'release {phase} {name}', f'{outcome} {s0}->{s1}')
    for i, s in enumerate(setups):
        check(s.group(1) == 'OK 200' and s.group(2) == 'READY', f'fence-{arm}',
              f'release-setup acquire #{i + 1}', f'{s.group(1)} state={s.group(2)}')


fence_arm('head', True)
fence_arm('base', False)

# --- operability ---
OP_MAT = re.compile(r'PROBE materializer single_poisoned warns_per_second=\[([0-9,]+)\] total_40s=(\d+)'
                    r' stack_traces=(\d+) defer_warns=(\d+) progress_row_writes_40s=(\d+)')
OP_SAT = re.compile(r'PROBE materializer poisoned=(\d+) .*progress_writes_per_s=(\d+) warns_10s=(\d+)')
OP_STARVE = re.compile(r'PROBE materializer starvation poisoned=33 healthy_event_materialized_after_ms=(.*)$')
OP_STALL = re.compile(r'PROBE stall phase=row_lock_held_25s materializer_thread=(\S+).*max_gap_ms=(\d+) ticks=(\d+)')
OP_START = re.compile(r'PROBE startup config=(\S+) -> (STARTED|REFUSED TO START: (.*))')

STARTUP_EXPECT_HEAD = {
    'base_url_schemeless': False, 'base_url_empty': False, 'base_url_ftp': False,
    'base_url_no_host': False,  # main-side plaintext-http guard fires on both arms
    'base_url_userinfo': False, 'base_url_query': False, 'base_url_fragment': False,
    'base_url_upper_scheme': True,
    'lease_renew_0s': False, 'lease_renew_999us': False, 'lease_renew_minus_1s': False,
    'lease_lease20s_renew20s': False, 'lease_lease60s_renew31s': False,
    'lease_lease60s_renew30s': True, 'lease_lease2s_renew500ms_e2e': True,
    'lease_defaults_60s_20s': True,
}
STARTUP_EXPECT_BASE_BUGGY = {  # configs the base wrongly accepts (controls)
    'base_url_schemeless', 'base_url_empty', 'base_url_ftp', 'base_url_userinfo',
    'base_url_query', 'base_url_fragment',
    'lease_renew_0s', 'lease_renew_999us', 'lease_renew_minus_1s',
    'lease_lease20s_renew20s', 'lease_lease60s_renew31s',
}


def oper_arm(arm, is_head):
    lines = probe_lines(f'oper-{arm}')
    if lines is None:
        check(False, f'oper-{arm}', 'log exists', 'missing')
        return
    text = '\n'.join(lines)
    m = OP_MAT.search(text)
    if m:
        total = int(m.group(2))
        if is_head:
            check(total <= 30, f'oper-{arm}', 'single poisoned Session: WARN lines in 40 s bounded',
                  f'total_40s={total} (base floods hundreds)')
        else:
            check(total >= 200, f'oper-{arm}', 'control: base floods WARN', f'total_40s={total}')
    else:
        check(False, f'oper-{arm}', 'single poisoned probe ran', 'no line')
    for m in OP_SAT.finditer(text):
        n, wps = int(m.group(1)), int(m.group(2))
        if is_head:
            if n == 32:
                check(wps <= 10, f'oper-{arm}', 'exactly-full window: no skip-path rotation',
                      f'writes/s={wps}')
            elif n == 33:
                check(wps >= 100, f'oper-{arm}', 'saturated window: rotation active', f'writes/s={wps}')
    m = OP_STARVE.search(text)
    if m:
        v = m.group(1)
        if is_head:
            check('NEVER' not in v and int(v) < 15000, f'oper-{arm}',
                  'starvation: healthy event materialized', f'after_ms={v}')
        else:
            check('NEVER' in v, f'oper-{arm}', 'control: base starves the healthy Session', v)
    else:
        check(False, f'oper-{arm}', 'starvation probe ran', 'no line')
    m = OP_STALL.search(text)
    if m:
        thread, gap, ticks = m.group(1), int(m.group(2)), int(m.group(3))
        if is_head:
            check('managed-materialization' in thread and ticks >= 200, f'oper-{arm}',
                  'materializer on its own scheduler; default scheduler alive',
                  f'thread={thread} ticks={ticks}/250 max_gap={gap}ms')
        else:
            check(ticks < 50, f'oper-{arm}', 'control: base stall blocks the shared scheduler',
                  f'thread={thread} ticks={ticks}/250')
    else:
        check(False, f'oper-{arm}', 'stall probe ran', 'no line')


def startup_arm(arm, is_head):
    lines = probe_lines(f'startup-{arm}')
    if lines is None:
        check(False, f'startup-{arm}', 'log exists', 'missing')
        return
    seen = {}
    for line in lines:
        m = OP_START.search(line)
        if m:
            seen[m.group(1)] = (m.group(2).startswith('STARTED'), line)
    for key, valid in STARTUP_EXPECT_HEAD.items():
        if key not in seen:
            check(False, f'startup-{arm}', f'config={key}', 'no probe line')
            continue
        started, line = seen[key]
        if is_head:
            check(started == valid, f'startup-{arm}', f'config={key}',
                  'STARTED' if started else line.split('-> ', 1)[1][:80])
        else:
            if key in STARTUP_EXPECT_BASE_BUGGY:
                check(started, f'startup-{arm}', f'config={key} (control: base starts)',
                      'STARTED' if started else 'refused')
            else:
                check(started == valid, f'startup-{arm}', f'config={key}',
                      'STARTED' if started else 'refused')
    k8s = [l for l in lines if 'config=kubernetes_provisioner' in l]
    if k8s:
        if is_head:
            check('REFUSED TO START' in k8s[0] and 'supported: local-process, static' in k8s[0],
                  f'startup-{arm}', 'kubernetes wording', k8s[0][:140])
        else:
            check('outside this review slice' in k8s[0] or 'REFUSED' in k8s[0],
                  f'startup-{arm}', 'control: base kubernetes wording', k8s[0][:140])
    rn = [l for l in lines if 'first_rename=' in l and 'base_url_valid_dead' in l]
    if rn:
        m = re.search(r'first_rename=HTTP (\d+) (\S+) server_log_lines=(\d+)', rn[0])
        warn = re.search(r'rename_warn="(.*?)" cause_in_log=(\S+)', rn[0])
        if is_head:
            check(m and m.group(1) == '503' and int(m.group(3)) > 0
                  and warn and 'Managed Agent rename' in warn.group(1) and warn.group(2) == 'true',
                  f'startup-{arm}', 'rename against dead Harness: 503 + WARN + cause', rn[0][:160])
        else:
            check(m and m.group(1) == '503' and int(m.group(3)) == 0,
                  f'startup-{arm}', 'control: base 503 without any log line', rn[0][:160])


oper_arm('head', True)
oper_arm('base', False)
startup_arm('head', True)
startup_arm('base', False)

# --- tool item identity: same on both arms ---
def ident_arm(arm):
    lines = probe_lines(f'ident-{arm}')
    if lines is None:
        check(False, f'ident-{arm}', 'log exists', 'missing')
        return
    for line in lines:
        m = re.match(r'PROBE (\S+) same_item=(\S+)', line)
        if m:
            check(m.group(2) == 'true', f'ident-{arm}', f'{m.group(1)} same item', line[:120])
        m = re.match(r'PROBE (\S+) public_items=(\d+)', line)
        if m:
            check(m.group(2) == '1', f'ident-{arm}', f'{m.group(1)} one public item', line[:120])
        m = re.match(r'PROBE C_upgrade stored_item=(\S+) update_item=(\S+)', line)
        if m:
            check(m.group(1) == m.group(2), f'ident-{arm}', 'pre-upgrade tool_call merges post-upgrade',
                  line[:140])


ident_arm('head')
ident_arm('base')

# --- summary ---
npass = sum(1 for r in results if r[0] == 'PASS')
nfail = sum(1 for r in results if r[0] == 'FAIL')
for status, group, name, detail in results:
    print(f'{status} {group} :: {name} :: {detail}')
print(f'---\nassertions: {npass} pass, {nfail} fail, {npass + nfail} total')
Path(LOGS / 'assertions.json').write_text(json.dumps({'pass': npass, 'fail': nfail, 'total': npass + nfail}))
sys.exit(1 if nfail else 0)
