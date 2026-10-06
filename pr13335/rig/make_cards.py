"""Generate the PR #13335 evidence cards as HTML (rendered by shoot.mjs)."""
import html, os

OUT = os.path.dirname(os.path.abspath(__file__))
CSS = """
body{margin:0;background:#0d1117;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:28px 32px 24px;background:#0d1117;min-width:900px}
h1{font-size:23px;margin:0 0 6px;font-weight:650}
.sub{color:#8b949e;font-size:13.5px;margin:0 0 16px;font-family:ui-monospace,Menlo,monospace}
table{border-collapse:collapse;font-family:ui-monospace,Menlo,monospace;font-size:13.5px}
th{background:#161b22;color:#8b949e;font-weight:600;text-align:left;padding:7px 12px;border:1px solid #30363d;white-space:nowrap}
td{padding:6px 12px;border:1px solid #30363d;white-space:nowrap;vertical-align:top}
tr.sec td{background:#161b22;color:#d2a8ff;font-weight:600;font-family:-apple-system,Helvetica,Arial,sans-serif}
.ok{color:#3fb950}.bad{color:#f85149}.warn{color:#d29922}.dim{color:#8b949e}.b{font-weight:700}
.note{margin-top:16px;border-left:3px solid #388bfd;padding:8px 14px;background:#161b22;font-size:14px;line-height:1.5;max-width:1180px;white-space:normal}
.note.red{border-color:#f85149}.note.amber{border-color:#d29922}.note.green{border-color:#3fb950}
pre{font-family:ui-monospace,Menlo,monospace;font-size:13px;background:#161b22;border:1px solid #30363d;padding:10px 14px;margin:10px 0 0;white-space:pre;color:#c9d1d9}
"""


def page(name, title, sub, body):
    doc = f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body><div id='card'><h1>{title}</h1><div class='sub'>{sub}</div>{body}</div></body></html>"
    open(os.path.join(OUT, name + '.html'), 'w').write(doc)


def table(headers, rows):
    out = ['<table><tr>' + ''.join(f'<th>{h}</th>' for h in headers) + '</tr>']
    for r in rows:
        if isinstance(r, str):
            out.append(f"<tr class='sec'><td colspan='{len(headers)}'>{r}</td></tr>")
        else:
            out.append('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>')
    return ''.join(out) + '</table>'


def c(cls, text):
    return f"<span class='{cls}'>{html.escape(text)}</span>"


ARMS = ("Real stack per arm: Spring jar + MySQL 8.4.7 + Hosted Harness (dist/cli.js) + embedded Broker, macOS, JDK 21. "
        "main = 28e0f3a8 &middot; PR = 76d51f3 and current head a2fa536e, each trial-merged with main (same results)")

# ---------------- Fig 1: unit binding ----------------
rows = [
    'Bare numbers meant as seconds (what the PR fixes)',
    ['DISPATCH_LEASE_DURATION=120', c('bad', 'PT0.12S'), c('ok', 'PT2M'), 'boots'],
    ['HARNESS_TURN_DEADLINE=1800', c('bad', 'PT1.8S'), c('ok', 'PT30M'), 'boots'],
    ['SESSION_STORE_WRITER_LEASE_DURATION=90', c('bad', 'PT0.09S'), c('ok', 'PT1M30S'), 'boots'],
    ['RUNTIME_BROKER_V3_RESULT_WINDOW=1800', c('bad', 'PT1.8S (passes the 1s floor)'), c('ok', 'PT30M'), 'boots'],
    ['TOOL_PUBLICATION_DELETION_GRACE=86400', c('bad', 'PT1M26.4S'), c('ok', 'PT24H'), 'boots'],
    ['APPROVAL_TIMEOUT=600', c('bad', 'boot refused (600 ms < 1s)'), c('ok', 'PT10M'), ''],
    'Stale milliseconds-style values (the upgrade direction the PR flips)',
    ['HARNESS_TURN_DEADLINE=600000', c('ok', 'PT10M'), c('bad', 'PT166H40M (6.9 days)'), 'boots'],
    ['RUNTIME_BROKER_V3_RESULT_WINDOW=300000', c('ok', 'PT5M'), c('warn', 'PT83H20M'), 'boots'],
    ['SESSION_STORE_WRITER_LEASE_DURATION=60000', c('ok', 'PT1M'), c('bad', 'PT16H40M'), 'boots'],
    ['DISPATCH_LEASE_DURATION=60000', c('ok', 'PT1M'), c('bad', 'PT16H40M'), 'boots'],
    ['TOOL_PUBLICATION_DELETION_GRACE=86400000', c('ok', 'PT24H'), c('bad', 'PT24000H'), 'boots'],
    ['TOOL_PUBLICATION_OPERATION_TIMEOUT=600000', c('ok', 'PT10M'), c('bad', 'PT166H40M'), 'boots'],
    ['APPROVAL_TIMEOUT=600000', c('ok', 'PT10M'), c('bad', 'boot refused (> 24h)'), ''],
    ['RUNTIME_BROKER_V3_RESULT_WINDOW=30 (meant 30 min)', c('ok', 'boot refused (< 1s floor)'), c('bad', 'PT30S, boots'), ''],
    'Unchanged',
    ['AUTH_ALLOWED_DRIFT=300000 / =300', 'PT5M / refused', 'PT5M / refused', 'MILLIS exception'],
    ['EVENTS_MATERIALIZE_INTERVAL=250', 'ms via @Scheduled placeholder', 'PT0.25S (typed, MILLIS)', 'default 100 ms: ~10 scans/s on both'],
    ['no overrides', 'all shipped defaults', 'identical', '0 warnings'],
]
page('01-unit-binding', 'Fig 1. Same operator env, two binaries: what each duration binds to',
     ARMS + '<br>Values read from /actuator/configprops of the booted jar (env vars as an operator writes them, prefix QWEN_MANAGED_AGENT_ omitted).',
     table(['operator env', 'main binds', 'PR binds', 'note'], rows) +
     "<div class='note'>The fix is real: on main a bare <b>120</b> meant as seconds bound as <b>120 ms</b>. "
     "The flip is also a silent upgrade hazard for the opposite habit: a stale <b>600000</b> (10 min in ms) now binds 6.9 days, "
     "and <b>APPROVAL_TIMEOUT=600000</b> turns a booting deployment into a refused boot. Fig 5 shows which of these the startup warning catches.</div>")

# ---------------- Fig 2: behavior ----------------
rows = [
    'A. HARNESS_TURN_DEADLINE=1800 (operator means 30 min); the fake model streams for 8 s',
    ['main', c('bad', 'turn.failed  hosted_turn_deadline_exceeded'), c('bad', '2.4 s'), 'deadline bound as 1.8 s'],
    ['PR', c('ok', 'turn.completed'), '8.6 s (current head 9.2 s)', 'deadline PT30M'],
    'B. DISPATCH_LEASE_DURATION=120, two Spring instances on one MySQL + one Harness, one 20 s Turn',
    ['main', c('bad', '2 dispatch owners claimed the Turn'), c('bad', '33.9 s'),
     '138/147 live samples RUNNING with no owner; owned lease left -651..108 ms'],
    ['', c('bad', '7 retries: 5 on B (Harness /load 409), 2 on A (runtime warm failed)'), '', 'public stream gained environment.failed'],
    ['PR', c('ok', '1 dispatch owner, 0 retries'), '20.7 s (current head 21.0 s)',
     '91/91 samples owned, lease left 100..120 s; 7 clean events'],
]
page('02-behavior', 'Fig 2. What the unit fix changes for a running Turn',
     ARMS + '<br>Turn outcome from the public event stream; lease from managed_agent_turn sampled every 200 ms.',
     table(['arm', 'outcome', 'time to terminal', 'evidence'], rows) +
     "<div class='note green'>Both arms got exactly one model request in B: the Harness refused the second claimant (409), "
     "so the duplicate never reached the model. What main pays is lease thrash: retries, a user-visible "
     "<b>environment.failed</b> event and +13 s on a 20 s Turn.</div>")

# ---------------- Fig 3: scheduler ----------------
rows = [
    ['main', 'scheduling-1  RUNNABLE  in MessageMaterializer -> requireSessionForUpdate', c('bad', '1'), '5 / 6', '51 / 2 / 47'],
    ['PR', 'message-materialize-1  RUNNABLE  in requireSessionForUpdate', c('ok', '39'), '6 / 5', '53 / 1 / 47'],
    ['', 'scheduling-1  TIMED_WAITING (idle, free for recovery scans)', '', '', ''],
]
page('03-scheduler', 'Fig 3. A stalled materialize pass no longer starves Turn recovery',
     ARMS + '<br>Stall: another MySQL session holds the materialize target row FOR UPDATE for 39.5 s. Counts from MySQL general_log; threads from jstack at +5 s.',
     table(['arm', 'threads during the stall (jstack)', 'recovery scans in 39.5 s stall', 'recovery scans 5 s before / after',
            'materialize scans before / stall / after'], rows) +
     "<div class='note green'>On main the four @Scheduled tasks shared one thread, so recoverExpiredTurns, recoverOperations and the "
     "action recovery ran once in 39.5 s. With the dedicated scheduler the recovery scan keeps its 1 s cadence (39 runs). "
     "Same result on the current head.</div>")

# ---------------- Fig 4: input + metadata ----------------
rows = [
    'Input budget (public create unless noted; every 202 below was followed through to its terminal event)',
    ['4 x 1,000,000 ASCII (aggregate = cap)', '202 -> hosted_harness_rejected', '202 -> hosted_harness_rejected'],
    ['5 x 1,000,000 ASCII', c('bad', '202 -> stored, then hosted_harness_rejected'), c('ok', '400 invalid_input (aggregate)')],
    ['4,000,001 total', c('bad', '202'), c('ok', '400 invalid_input')],
    ['5 x 1M via WebShell turns/submit and public events', c('bad', '202 / 202'), c('ok', '400 / 400 invalid_input')],
    ['100 x 1,000,000 ASCII', c('bad', '500 internal_error (fastjson2 64 MiB array limit)'), c('ok', '400 invalid_input in 0.3 s')],
    ['1 x 1,000,001 ASCII', '400 invalid_request (@Size)', c('warn', '400 invalid_input (code changed)')],
    ['1 x 1,000,000 astral code points', '400 invalid_request (2M UTF-16 units)', '202 -> hosted_harness_rejected'],
    ['one block of 65,000 / 66,000 ASCII', '202 completed / 202 hosted_harness_rejected', 'identical'],
    'WebShell metadata (sessions/create; submit behaves the same)',
    ['{"clientId":"c1"}  and  {}', '202', '202'],
    ['{"clientId":"c1","other":...}', c('bad', '400 unsupported_feature'), c('ok', '202')],
    ['{"traceId":...}  /  clientId of 200 chars', c('bad', '400 unsupported_feature'), c('ok', '202')],
    ['["..."]  /  "scalar"', '400 invalid_request', '400 invalid_request'],
    ['metadata markers found in a full mysqldump', '0', c('ok', '0 (accepted, never stored)')],
    'WebShellTurn on the wire (sessions/get while running and after completion)',
    ['keys', 'turnId sessionId status submittedAt [completedAt]', 'identical: usage was never emitted'],
]
page('04-input-metadata', 'Fig 4. Input budget, metadata and WebShellTurn on the wire',
     ARMS + '<br>The Hosted Harness stores a prompt inline only up to 64 KiB (OSS disabled), so 66,000+ chars always fail after 202 on both arms.',
     table(['request', 'main', 'PR'], rows) +
     "<div class='note amber'>The aggregate cap works on all three admission routes. Two contract notes: a block over 1M now answers "
     "<b>invalid_input</b> instead of <b>invalid_request</b>, and a prompt over 10 MB of UTF-8 (measured: 4 blocks of 1M astral code points, "
     "newly admissible) fails with <b>hosted_harness_protocol_error</b>, because the Harness's express 413 body has no code, "
     "not with the hosted_harness_rejected that the new OpenAPI sentence names.</div>")

# ---------------- Fig 5: warning coverage ----------------
Y, N, FP = c('ok', 'warns'), c('bad', 'silent'), c('bad', 'warns (false positive)')
rows = [
    'Stale milliseconds-style overrides (should warn)',
    ['HARNESS_TURN_DEADLINE=600000 -> PT166H40M', N, N, Y],
    ['RUNTIME_BROKER_V3_RESULT_WINDOW=300000 -> PT83H20M', N, N, Y],
    ['SESSION_STORE_WRITER_LEASE_DURATION=60000', Y, Y, Y],
    ['DISPATCH_LEASE_DURATION=60000', Y, Y, Y],
    ['TOOL_PUBLICATION_DELETION_GRACE=86400000', Y, Y, Y],
    ['APPROVAL_TIMEOUT=600000 (boot refused)', N, Y, Y],
    ['RUNTIME_BROKER_V3_RESULT_WINDOW=30 -> PT30S', N, Y, Y],
    ['TOOL_PUBLICATION_{OPERATION,CLAIM,MAX_VERIFICATION}_TIMEOUT', N + ' x3', Y + ' x3', Y + ' x3'],
    [c('warn', 'stale values caught (of 10)'), '3', '8', c('ok', '10')],
    'Suffixed values (should stay quiet)',
    ['LEASE_DURATION=2s, LEASE_RENEW_INTERVAL=500ms, WRITER_LEASE=1s', c('ok', 'quiet'), FP + ' x3', c('ok', 'quiet')],
    ['HARNESS_TURN_DEADLINE=2m, APPROVAL_TIMEOUT=30s', c('ok', 'quiet'), FP + ' x2', c('ok', 'quiet')],
    ['no overrides', c('ok', 'quiet'), c('ok', 'quiet'), c('ok', 'quiet')],
]
page('05-warning-coverage', 'Fig 5. Startup unit warning: which overrides it catches',
     'Each row is a real Spring boot; WARN lines read from the server log. 76d51f3 and a2fa536e are trial-merged with main; '
     'the candidate is a2fa536e + the shape-based patch below.',
     table(['operator env', 'PR @ 76d51f3', 'PR @ a2fa536e (round 6)', 'candidate: warn on bare numbers'], rows) +
     "<div class='note red'>Round 6 (written without a JDK; first executed here) raised coverage from 3 to 8 of 10, but its new "
     "&le; default/10 band fires on the repo's own E2E failover values (<b>2s / 500ms / 1s</b>) and on deliberate short timeouts, and "
     "tells the operator to &quot;write an explicit suffix&quot; they already wrote. Keying on the written text instead of the "
     "magnitude catches all 10 and never fires on a suffix.</div>"
     "<pre>WARN qwen.managed-agent.harness.turn-deadline=600000 has no unit suffix and binds as PT166H40M (seconds);\n"
     "     before this change a bare number bound as milliseconds (PT10M). Write the unit (for example\n"
     "     600000s or 600000ms) to make the intent explicit.</pre>")
print('ok')
