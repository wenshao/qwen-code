# VERIFICATION RIG ONLY (PR #13354): compile fig/summary.json from probe result files.
import json, os, html
RIG = '/Users/wenshao/pr13354-rig'
def res(db, name):
    p = f'{RIG}/results/{db}/{name}.json'
    return json.load(open(p)) if os.path.exists(p) else None
def cnt(r): return f"{r['pass']}/{r['pass'] + r['fail']}"
def OK(t): return {'c': 'ok', 't': '✔ ' + t}
def BAD(t): return {'c': 'bad', 't': '✘ ' + t}
def WARN(t): return {'c': 'warn', 't': '▲ ' + t}
def MUTE(t): return {'c': 'mute', 't': t}
def okc(r, extra=''):
    if r is None: return MUTE('—')
    return OK(cnt(r) + extra) if r['fail'] == 0 else BAD(cnt(r) + extra)
def both(a, b, la, lb):
    if a is None and b is None: return MUTE('—')
    parts = []; ok = True
    for r, l in ((a, la), (b, lb)):
        if r is None: continue
        parts.append(f"{l} {cnt(r)}"); ok = ok and r['fail'] == 0
    return (OK if ok else BAD)(' · '.join(parts))
def row(r, label):
    if r is None: return None
    return next((x for x in r['rows'] if x['label'].startswith(label)), None)

arms = ['base', 'facc', 'faccm', 'c65', 'c65m']
labels = ['base<br><code>69d060e24c</code>', 'PR head<br><code>facc4ab1f</code>', '<code>facc4ab1f</code><br>+ main <code>85ea2358dc</code>', 'PR head<br><code>c65e46d04e</code>', '<code>c65e46d04e</code><br>+ main <code>91cf9ed6c0</code>']
dbs = {'base': 'b1', 'facc': 'h1', 'faccm': 'm1', 'c65': 's6', 'c65m': 's7'}
M = {a: {} for a in arms}
# delete flow
b = res('b1', 'p1-delete')
M['base']['del'] = MUTE(f"pre-PR, as expected ({cnt(b)}): 409 <code>session_state_conflict</code>, capability false, no operation")
for a in ['facc', 'faccm', 'c65', 'c65m']:
    M[a]['del'] = okc(res(dbs[a], 'p1-delete'))
# edges
M['base']['edges'] = OK(cnt(res('b1', 'p2-edges')) + ' (close = legacy <code>DELETE /session</code>)')
for a in ['facc', 'faccm', 'c65', 'c65m']: M[a]['edges'] = okc(res(dbs[a], 'p2-edges'))
# approval
for a in ['faccm', 'c65', 'c65m']: M[a]['appr'] = okc(res(dbs[a], 'p9-approval'))
# restart
M['base']['restart'] = OK(cnt(res('b1', 'p3-restart-TERM')) + ' TERM (close only)')
M['facc']['restart'] = both(res('h1', 'p3-restart-TERM'), res('h1', 'p3-restart-KILL'), 'TERM', 'KILL')
M['faccm']['restart'] = okc(res('m1', 'p3-restart-KILL'), ' KILL')
M['c65']['restart'] = okc(res('s6', 'p3-restart-TERM'), ' TERM')
M['c65m']['restart'] = okc(res('s7', 'p3-restart-TERM'), ' TERM')
# crash
M['facc']['crash'] = okc(res('h1', 'p4-crash-ABC'), ' (A/B/C)')
M['faccm']['crash'] = okc(res('m1', 'p4-crash-A'), ' (A)')
M['c65']['crash'] = okc(res('s6', 'p4-crash-ABC'), ' (A/B/C)')
M['c65m']['crash'] = okc(res('s7', 'p4-crash-ABC'), ' (A/B/C)')
# upgrade
M['facc']['upgrade'] = okc(res('b1', 'p6-upgrade'), ' (V40→V41 on base data)')
# hooks basic
M['base']['hooks'] = BAD('close never completes: <code>DELETE /session</code> 503 ×N, “Hosted Hook requires reconciliation”')
M['facc']['hooks'] = okc(res('h2', 'p5-hooks-basic'))
for a in ['faccm', 'c65', 'c65m']: M[a]['hooks'] = okc(res(dbs[a], 'p5-hooks-basic'))
# R3-1
M['base']['r31'] = MUTE('n/a (hooked close fails even without a restart)')
M['facc']['r31'] = BAD('stuck: every lifecycle load 409 <code>hosted_session_already_attached</code>')
r4 = res('r4h', 'p5c-r4'); r5 = res('r6h', 'p5c-merge2')
M['c65']['r31'] = BAD('stuck: load 200, then <code>/lifecycle</code> 503 ×7; SessionEnd recorded <code>outcome_unknown</code>, 0 Hook requests') if r4 and r4['fail'] else (OK('completes') if r4 else MUTE('—'))
M['c65m']['r31'] = (BAD('stuck: same as head') if r5['fail'] else OK('completes')) if r5 else MUTE('—')
rows = [
    {'key': 'del', 'label': 'ACTIVE <b>delete</b>: 202 → DELETING → DELETED, original worker stopped, registration RETIRED, binding RELEASED with receipt, neighbour Session + shared files intact, same-key replay → same operation'},
    {'key': 'edges', 'label': 'Refusals 403 / 404 / 409 <code>turn_active</code> persist nothing · ACTIVE <b>close</b> → CLOSED (protocol 1, authorized detach, no legacy DELETE) · L2 delete after close / archive: 0 Harness calls · while DELETING: input + Broker warm 409 · empty Session deletes'},
    {'key': 'appr', 'label': 'Approval-waiting Turn → 409 <code>turn_active</code>; deletes after it settles'},
    {'key': 'restart', 'label': 'Spring restarted (TERM / SIGKILL) while the Harness keeps its attachments, then delete + close'},
    {'key': 'crash', 'label': 'SIGKILL Spring mid-delete, successor (claim gen ≥ 2) completes: A detach reply lost · B detach never sent · C completion blocked on a row lock'},
    {'key': 'upgrade', 'label': 'Upgrade on a base database: V41 applied, historical ops protocol 0, in-flight base CLOSE finishes under the PR coordinator, base-created ACTIVE Session deletes'},
    {'key': 'hooks', 'label': '<i>Simulated Hook catalog</i>: close → SessionEnd ×1, SessionDelete ×0; delete → SessionEnd then SessionDelete (matching <code>deleted_session_id</code>); no re-run'},
    {'key': 'r31', 'label': '<i>Simulated Hook catalog</i> — <b>R3-1</b>: hooked delete / close after a Spring restart (Harness kept)'},
]
summary = {'arms': arms, 'armLabels': labels, 'matrix': M, 'rows': rows}

# ---------- R3-1 panel ----------
def pre(lines): return '<pre>' + html.escape('\n'.join(lines)) + '</pre>'
h3 = res('h3', 'p5-hooks-r31')
tl = row(h3, '[R3-1] timeline after Spring restart')['detail']
w3 = row(h3, '[H3 R3-1] every attempt')['detail']
panel1 = [
    'facc4ab1f   tap: Spring → Harness for the hooked Session after the Spring restart',
    *[f'  {x}' for x in w3[:3]], f'  … {len(w3)} attempts, all the same',
    'Spring log : DaemonHttpException POST /session/:id/load failed with HTTP 409: {"code":"hosted_session_already_attached"}',
    f"operation  : {tl[0]['del']}  (t+{tl[0]['s']} s)  →  {tl[-1]['del']}  (t+{tl[-1]['s']} s)",
    'Session    : DELETING / CLOSING;  Hook endpoint: 0 requests;  original workers alive',
    'then restart the Harness too → load 200, /lifecycle 503: "Managed Session writer grant is stale or unavailable" (permanent)',
]
panel2 = [
    'c65e46d04e  same scenario (and my 20-line daemon candidate gave the identical result)',
    '  POST /session/:id/load -> 200 lifecycleLoad                (adoption now works)',
    '  POST /session/:id/lifecycle -> 503 kind=delete auth=op_…/g1 … g7',
    'Harness log: Hosted lifecycle requires recovery: Hosted Hook requires reconciliation of its original execution.',
    'hook record: SessionEnd  run.state=recovery_blocked  reason=outcome_unknown  executionCallId=null',
    'operation  : RECOVERY_BLOCKED / workspace_lifecycle_hooks_unsettled / gen7 / att7;  Hook endpoint: 0 requests',
]
if r5: panel2.append(f"c65e46d04e + main 91cf9ed6c0: {'same' if r5['fail'] else 'completes'} ({cnt(r5)} checks)")
summary['r31html'] = (
    '<h2>Control (no restart): the hooked path works</h2>' +
    '<table><tr><th>arm</th><th>close</th><th>delete</th></tr>'
    '<tr><td>facc4ab1f / c65e46d04e / both merges</td><td class="ok">✔ SessionEnd ×1, SessionDelete ×0 (~0.6 s)</td><td class="ok">✔ SessionEnd → SessionDelete (+0.38 s), deleted_session_id matches (~0.9 s)</td></tr>'
    '<tr><td>base</td><td class="bad">✘ legacy DELETE 503 ×N</td><td class="mute">ACTIVE delete unsupported</td></tr></table>' +
    '<h2>After one Spring TERM restart (Harness keeps the attachment)</h2>' + pre(panel1) + pre(panel2) +
    '<div class="note nbad">The 409 layer is fixed at <code>c65e46d04e</code>, but the end result is unchanged. The SessionEnd dispatch from the adopted attachment is persisted as <code>outcome_unknown</code> without running, so by the PR\'s own rule the operation can never complete. A control Session that ran an ordinary Turn first could not run that Turn either: the ordinary load is refused for hooked attachments (pre-existing <code>!attached.hooks</code> redrive guard).</div>'
)

# ---------- rollout + contention ----------
roll = '<h2>Rollout order (fresh database per row)</h2><table><tr><th>Spring (coordinator + Session Store)</th><th>Hosted Harness</th><th>ordinary Turns</th><th>ACTIVE close</th><th>ACTIVE delete</th></tr>'
roll += '<tr><td>base</td><td>base</td><td class="ok">✔ (control: private Turn 1.5 s)</td><td class="ok">✔ legacy</td><td class="mute">409 (pre-PR)</td></tr>'
roll += '<tr><td>PR (facc4ab1f, c65e46d04e)</td><td>base</td><td class="ok">✔</td><td class="warn">▲ capability false, 409 <code>workspace_unavailable</code></td><td class="ok">✔ refused 409, nothing admitted</td></tr>'
roll += '<tr><td>base</td><td>PR (facc4ab1f, c65e46d04e)</td><td class="bad">✘ every Turn (Workspace and private) stays ACCEPTED: Harness answers each prompt 503 <code>hosted_execution_authorization_unavailable</code>, Spring retries forever</td><td class="bad">✘ never reached (no Turn settles)</td><td class="mute">409 (pre-PR Spring)</td></tr>'
roll += '<tr><td>PR</td><td>PR</td><td class="ok">✔</td><td class="ok">✔</td><td class="ok">✔</td></tr></table>'
def p8(db, name):
    r = res(db, name)
    if not r: return None
    rounds = r['rounds']; n = r['N'] * r['ROUNDS']
    done = sum(x['completed'] for x in rounds)
    lock = sum(x['Innodb_row_lock_time'] for x in rounds) / 1000
    q = sum(x['Questions'] for x in rounds) / n
    wall = '/'.join(f"{x['wall']/1000:.1f}" for x in rounds)
    return dict(n=n, N=r['N'], done=done, lock=lock, q=q, wall=wall)
crow = []
for label, items in [
  ('base <code>69d060e24c</code>', [('pb','p8-contention-8x3'),('pb3','p8-contention-8x3'),('pb5','p8-contention-16x2')]),
  ('PR head <code>facc4ab1f</code> (as pushed)', [('ph','p8-contention-8x3'),('ph2','p8-contention-8x1'),('ph3','p8-contention-8x1'),('ph4','p8-contention-8x1'),('ph5','p8-contention-8x1')]),
  ('PR head <code>c65e46d04e</code> (as pushed)', [('pr4a','p8-contention-8x2')]),
  ('main <code>85ea2358dc</code>', [('pc8','p8-contention-8x3'),('pc16','p8-contention-16x2')]),
  ('<code>facc4ab1f</code> + main', [('pm3','p8-contention-8x3'),('pm4','p8-contention-8x3'),('pm8','p8-contention-8x3'),('pm5','p8-contention-16x2'),('pm16','p8-contention-16x2')]),
  ('<code>c65e46d04e</code> + main <code>91cf9ed6c0</code>', [('pm2a','p8-contention-8x3'),('pm2b','p8-contention-16x2')]),
]:
    for db, name in items:
        x = p8(db, name)
        if not x: continue
        ok = x['done'] == x['n']
        crow.append(f"<tr><td>{label}</td><td class='num'>{x['N']}</td><td class='{'ok' if ok else 'bad'}'>{'✔' if ok else '✘'} {x['done']}/{x['n']}</td><td class='num'>{x['wall']}</td><td class='num'>{x['lock']:.1f}</td><td class='num'>{x['q']:.0f}</td></tr>")
cont = '<h2>Concurrent Turns in one tenant (4 Workspaces, container has 4 vCPU = 4 virtual-thread carriers)</h2><table><tr><th>arm</th><th>N</th><th>Turns completed</th><th>wall per round (s)</th><th>InnoDB row-lock wait (s, all rounds)</th><th>SQL statements / Turn</th></tr>' + ''.join(crow) + '</table>'
cont += '<div class="note nbad">As pushed (both heads), the failed Turns are <code>managed_session_open_failed</code>: the Harness\'s <code>POST /writers:acquire</code> times out. The head of the wait chain is an InnoDB transaction holding the tenant <code>qwen_runtime_placement_guard</code> row while its connection sits idle for up to 59 s. Waiting behind it are 4 Store request threads (the PR\'s <code>checkLifecycleWriter → lockPlacement</code>) and 4 <code>runtime-provisioner</code> threads. JFR shows a 30 s <code>JavaMonitorEnter</code> at <code>QwenHostedHarnessConnector.createOrLoad:188</code>: the pre-#13403 <code>computeIfAbsent</code> pinning. The base also fails at N=16, but with a different signature: no InnoDB lock-wait timeouts, only Harness → Spring request timeouts. That fits the known carrier pinning, which the PR\'s tenant-wide placement guard in the Store writer path brings forward to N=8.</div>'
cont += '<div class="note nok">After a trial merge with current main (#13403), every run completes. Against main the PR adds +11–13 % SQL statements per Turn at N=8 (+3–5 % at N=16) and more row-lock wait (N=8: 6.7–8.6 s vs 5.1 s; N=16: 27–36 s vs 27 s), with wall time within noise.</div>'
summary['rollhtml'] = roll + cont
json.dump(summary, open(f'{RIG}/fig/summary.json', 'w'), indent=1)
print('summary ok')
