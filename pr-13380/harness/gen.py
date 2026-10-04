import json, re, os

RUNS = '/root/verify/pr13380/runs'
R = '\x1b[0m'; B = '\x1b[1m'; RED = '\x1b[31m'; GRN = '\x1b[32m'; YEL = '\x1b[33m'
CYN = '\x1b[36m'; GRY = '\x1b[90m'; MAG = '\x1b[35m'


def events(tag):
    return [json.loads(l) for l in open(f'{RUNS}/{tag}/verify.jsonl')]


def rc(tag):
    return int(re.search(r'rc=(\d+)', open(f'{RUNS}/{tag}/RESULT').read()).group(1))


def ev(evs, name, **match):
    for e in evs:
        if e['event'] == name and all(e.get(k) == v for k, v in match.items()):
            return e
    return None


def counters(tag):
    f = ev(events(tag), 'finish')
    if not f:
        return ''
    parts = []
    if f.get('fencedWriterRenewals'):
        parts.append(f"fencedWriterRenewals={f['fencedWriterRenewals']}")
    if f.get('staleWriterConflicts'):
        parts.append(f"staleWriterConflicts={f['staleWriterConflicts']}")
    return ', '.join(parts)


def cell(tag, width, expect_fail=False):
    if tag is None:
        return f"{GRY}{'n/a':<{width}}{R}"
    ok = rc(tag) == 0
    if ok:
        c = counters(tag)
        label = 'pass' + (f' ({c.replace("fencedWriterRenewals", "renew-tol").replace("staleWriterConflicts", "new-branch")})' if c else '')
        color = RED if expect_fail else GRN
        if expect_fail:
            label = 'PASS = false green'
    else:
        label = 'FAIL' + (' (correct)' if expect_fail else '')
        color = GRN if expect_fail else RED
    return f"{color}{label:<{width}}{R}"


spec = []

# ---------------- fig 1: scenario matrix ----------------
W0, W = 70, 26
hdr = f"{B}{'scenario: one real Store request, held in the proxy':<{W0}}{R}" \
      f"{B}{'A0 #13370 driver':<{W}}{'A1 main (#13385)':<{W}}{'A2 this PR':<{W}}{'A2 minus identity guard':<{W}}{R}"
rows = [
    ('S1', 'renew answered AFTER the cold-load acquire (gen 1->2)', 'the order in the #13370 CI log', 's1-a0-pre13385', 's1-a1-main', 's1-a2-pr', None, False),
    ('S2', 'renew answered after its lease EXPIRED, before restart', 'gen still 1; `cli` is still the killed boot', 's2-a0-pre13385', 's2-a1-main', 's2-a2-pr', None, False),
    ('S3', 'harness-result: tool_result COMMIT answered late', 'after the cold-load acquire; not a renew', 's3-a0-pre13385', 's3-a1-main', 's3-a2-pr', None, False),
    ('R ', 'renew answered 1 s BEFORE its lease expires -> 200', "extends the dead writer's lease", None, 'rbe2-a1-main', 'rbe2-a2-pr', None, False),
    ('N2', 'negative control: LIVE writer fenced (lease expired)', 'nothing was killed; must stay red', None, 'n2-a1-main', 'n2-a2-pr', 'n2-a2-mut-noidentity', True),
]
lines = [hdr, '']
for key, a, b, t0, t1, t2, t3, neg in rows:
    lines.append(f"{B}{key}{R}  {a:<{W0-4}}" + cell(t0, W, neg) + cell(t1, W, neg) + cell(t2, W, neg) + cell(t3, W, neg))
    lines.append(f"    {GRY}{b}{R}")
lines += ['',
          f"{GRY}renew-tol = tolerated by the #13385 branch (fencedWriterRenewals); new-branch = tolerated by this PR's branch (staleWriterConflicts).{R}",
          f"{GRY}Every 409 above is the real Spring Store's answer over MySQL 8.4.11: {{\"error\":{{\"code\":\"managed_session_writer_conflict\",...}}}}.{R}",
          '',
          f"{B}Unmodified gate (no hooks), all six faults:{R}  PR head 7f0f3ded  run 1 {GRN}6/6 pass (109.5 s){R}   run 2 {GRN}6/6 pass (108.6 s){R}"
          f"   PR merged on main 292c49ec  {GRN}6/6 pass (110.0 s){R}"]
spec.append({'name': 'pr13380-crash-gate-matrix', 'maxCols': 190,
             'title': 'PR #13380 · HostedProcessCrashIT on the real stack: one stalled Store request, four driver arms',
             'sub': ['Real topology: Spring Session Store + embedded Runtime Broker + bundled dist/cli.js Harness + MySQL 8.4.11 + JDK 21, Linux x86_64. Fault: worker-stop (the #13370 case) unless noted.',
                     'Identical hooks in every arm hold one request inside the crash driver\'s proxy and release it at a chosen moment; the proxy\'s own 409 classification (the code under test) is unchanged.'],
             'rows': [['\n'.join(lines)]]})

# ---------------- fig 2: S2 timeline (PR merged on main) + R ----------------


def timeline(tag, label, arm):
    evs = events(tag)
    k = ev(evs, 'sigkill')['t']
    cap = ev(evs, 'captured')
    rel = ev(evs, 'release')
    up = ev(evs, 'upstream')
    cl = ev(evs, 'classified')
    acq2 = [e for e in evs if e['event'] == 'acquire-200' and e.get('writerGeneration') == 2]
    def t(e):
        x = (e['t'] - k) / 1000
        return f"{0.0 if abs(x) < 0.005 else x:+6.2f} s"
    L = [f"{B}{label}{R}", f"{GRY}  time after SIGKILL   event{R}"]
    L.append(f"  {t(cap)}   proxy holds POST writers:renew  {GRY}(killed boot, writerGeneration={cap['writerGeneration']}){R}")
    L.append(f"  {'+0.00 s'}   driver SIGKILLs the Harness  {GRY}(`cli` keeps pointing at it until the restart){R}")
    L.append(f"  {t(rel)}   lease expired -> request released to the real Store")
    body = json.loads(up['body'])
    L.append(f"  {t(up)}   Store: {YEL}409 {body['error']['code']}{R}")
    L.append(f"             {GRY}writerKilledByDriver={str(up['writerKilledByDriver']).lower()}  writerIsCurrentCli={str(up['writerIsCurrentCli']).lower()}  -> the #13385 branch skips it{R}")
    if cl['outcome'] == 'accepted':
        f = ev(evs, 'finish')
        L.append(f"  {t(cl)}   proxy: {GRN}accepted by the killed-writer branch{R}  {GRY}(staleWriterConflicts={f['staleWriterConflicts']}){R}")
        if acq2:
            L.append(f"  {t(acq2[0])}   restored Harness: writers:acquire -> 200, writerGeneration=2")
        L.append(f"             cold load -> 409 hosted_turn_recovery_required, no Broker call, no model call")
        L.append(f"  {GRN}HOSTED_PROCESS_CRASH_OK   Tests run: 1, Failures: 0{R}")
    else:
        L.append(f"  {t(cl)}   proxy: {RED}falls through to the strict branch -> proxyFailure{R}")
        L.append(f"  {RED}AssertionError [ERR_ASSERTION]: http://127.0.0.1:<port>/internal/managed-session-store/{R}")
        L.append(f"  {RED}  v1/sessions/<id>/writers:renew: {{\"error\":{{\"code\":\"managed_session_writer_conflict\",{R}")
        L.append(f"  {RED}  \"message\":\"The Managed Session writer grant is stale or unavailable.\",...}}}}{R}")
        L.append(f"  {RED}HostedProcessCrashIT: Tests run: 1, Failures: 1{R}   {GRY}(same assertion text as #13370 run 37179596621){R}")
    return '\n'.join(L)


def rbe_pane(tag):
    evs = events(tag)
    k = ev(evs, 'sigkill')['t']
    cap = ev(evs, 'captured'); rel = ev(evs, 'release'); up = ev(evs, 'upstream')
    wr = ev(evs, 'writer-response', route='writers:acquire')
    body = json.loads(up['body'])
    ext = body['leaseUntil'] - cap['leaseUntil']
    def t(e):
        x = (e['t'] - k) / 1000
        return f"{0.0 if abs(x) < 0.005 else x:+6.2f} s"
    L = [f"{B}{YEL}[residual window, same on main and on this PR]{R}{B}  scenario R: the killed Harness's renew lands BEFORE its lease expires{R}",
         f"{GRY}  time after SIGKILL   event{R}",
         f"  {t(cap)}   proxy holds POST writers:renew  {GRY}(killed boot, writerGeneration=1){R}",
         f"  {'+0.00 s'}   driver SIGKILLs the Harness",
         f"  {t(up)}   Store: {GRN}200{R}, leaseUntil moved {YEL}+{ext/1000:.1f} s{R}  {GRY}(a dead writer now holds the lease until +{(up['t'] - k)/1000 + 5:.1f} s){R}",
         f"             driver waits its fixed close()+5.1 s, then boots the restored Harness",
         f"  {t(wr)}   restored Harness: writers:acquire -> Store {RED}409 {wr['code']}{R}  {GRY}(new writer){R}",
         f"             proxy: a 409 for a writer nobody killed -> strict branch -> proxyFailure",
         f"  {RED}cold load -> 503 managed_session_open_failed (expected 409) -> Failures: 1, on main and on this PR{R}"]
    return '\n'.join(L)


spec.append({'name': 'pr13380-s2-timeline', 'maxCols': 118,
             'title': 'PR #13380 · scenario S2 on the landing tree (this PR merged onto main 292c49ec)',
             'sub': ["Both panes run the same build, MySQL and hooks; only the crash driver differs (main's vs this PR's). The fenced renew arrives while `cli` is still the killed boot, so main's #13385 branch (which excludes cli.bootId) does not take it.",
                     'Bottom: the stall map has one more window that neither #13385 nor this PR covers (follow-up, not a blocker).'],
             'rows': [[timeline('merged-s2-a1-main', f'{RED}[main driver]{R}', 'main'), timeline('merged-s2-a2-pr', f'{GRN}[this PR driver]{R}', 'pr')],
                      [rbe_pane('rbe2-a2-pr')]]})

# ---------------- fig 3: unit ladder ----------------
lad = {}
for f in os.listdir('/root/verify/pr13380/unit/logs2'):
    m = re.match(r'q(\d+)-(arm\w+)-(\d+)\.log\.meta$', f)
    if m:
        q, arm, rep = m.groups()
        code = re.search(r'EXIT=(\d+)', open('/root/verify/pr13380/unit/logs2/' + f).read()).group(1)
        lad.setdefault((int(q), arm), []).append(code != '0')
settle = {q: sorted(int(x) for x in open(f'/root/verify/pr13380/unit/logs2/settle-q{q}.txt').read().split()) for q in (5, 3, 2, 1)}


def fc(q, arm):
    v = lad.get((q, arm))
    if not v:
        return f"{GRY}{'-':<20}{R}"
    n, f = len(v), sum(v)
    col = RED if f else GRN
    return f"{col}{f'{f}/{n} fail':<20}{R}"


L = [f"{B}{'CPU quota':<11}{'requested() settle':<22}{'base: 1 s default':<20}{'this PR: 5 s':<20}{'#13399: 10 s':<20}{R}"]
for q in (5, 3, 2, 1):
    s = settle[q]
    L.append(f"{q:>3} %      {f'{s[0]:,}-{s[-1]:,} ms':<22}" + fc(q, 'armbase') + fc(q, 'armpr') + fc(q, 'armten'))
L += ['',
      f"{B}base at 3 %{R} (settle 0.9-1.1 s, right at the 1 s default) fails with the #13397 line verbatim:",
      f"  {RED}AssertionError: expected 'before_model' to be 'await_action' // Object.is equality{R}",
      f"  {GRY}> hosted-workspace-tool-turn.test.ts:1833   expect((await checkpoint()).continuation.phase).toBe('await_action'){R}",
      f"{B}this PR at 1 %{R} (settle 5.7-17.8 s) still fails at {CYN}vi.waitFor.timeout{R} after 5 s with the same assertion:",
      f"  {GRY}the wait is bounded, and no check was removed{R}",
      '',
      f"{B}Unthrottled{R}: 34 requested() calls settle in 50-151 ms; the whole file passes {GRN}146/146{R} on PR head and on PR+main.",
      f"{B}Overlap{R}: #13399 (approved) edits the same requested() lines with {{ timeout: 10_000 }};",
      f"  {YEL}git merge-tree main+#13380 vs #13399 -> CONFLICT (content) in hosted-workspace-tool-turn.test.ts{R}"]
spec.append({'name': 'pr13380-unit-ladder', 'maxCols': 118,
             'title': 'PR #13380 · requested() wait: cgroup CPU quota ladder (reproduces main CI #13397)',
             'sub': ["Test: 'reports an answer that loses the race to the expiry as expired', run as main CI does (CI=true, coverage on, ecs-qwen RUNNER_NAME, no retry), 4 runs per cell.",
                     'A transient systemd scope applies the CPU quota after collection, when the test creates its temp dir. Arms are sibling copies of the test file in one build.'],
             'rows': [['\n'.join(L)]]})

json.dump(spec, open('/root/verify/pr13380/shots/spec.json', 'w'), indent=1)
print('ok', [s['name'] for s in spec])
