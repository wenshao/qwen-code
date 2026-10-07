"""Round-2 evidence cards for PR #13335 (head 8b690bef)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_cards as base  # reuses CSS/table helpers; regenerating round-1 cards is harmless

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'r2')
os.makedirs(OUT, exist_ok=True)
c, table = base.c, base.table


def page(name, title, sub, body):
    doc = (f"<!doctype html><html><head><meta charset='utf-8'><style>{base.CSS}</style></head>"
           f"<body><div id='card'><h1>{title}</h1><div class='sub'>{sub}</div>{body}</div></body></html>")
    open(os.path.join(OUT, name + '.html'), 'w').write(doc)


SUB = ("Real Spring boots on MySQL 8.4.7, JDK 21. main = 9a02f405 &middot; PR = 8b690bef trial-merged with main (1e5d0e71) "
       "&middot; candidate 2 = PR + the patch below. Values from /actuator/configprops, WARN lines from the server log.")
Q, W = c('ok', 'quiet'), c('ok', 'warns')
rows = [
    'What round 7 fixed (all confirmed)',
    ['10 stale ms overrides (turn-deadline=600000, v3-window=300000, ...)', 'bind as ms', c('ok', '10/10 warn'), c('ok', '10/10 warn')],
    ['5 suffixed values (2s, 500ms, 1s, 2m, 30s)', '-', c('ok', '0 warnings'), c('ok', '0 warnings')],
    ['APPROVAL_TIMEOUT=600000', 'PT10M, boots', 'refused; message now says "write 300s rather than 300000"', 'same'],
    ['no overrides', '-', Q, Q],
    'Still open on 8b690bef (review R4-4, R4-2, R4-3, R4-5)',
    ['QWEN_MANAGED_AGENT_ENVIRONMENT=prod', c('ok', 'boots (key ignored)'),
     c('bad', 'BOOT REFUSED: Failed to bind qwen.managed-agent.environment'), c('ok', 'boots')],
    ['HARNESS_TURN_DEADLINE=+600000', 'PT10M', c('bad', 'PT166H40M, silent'), W],
    ['READ_REVALIDATION_INTERVAL=0, READ_GRANT_RECHECK_INTERVAL=0', 'PT0S', c('bad', '2 warnings: "PT0S ... before (PT0S)"'), Q],
    ['example in every warning', '-', c('warn', '"1800000ms or 30m" for every field'), c('ok', '"120ms ... or 120s" (the value written)')],
    'New field from main since round 1',
    ['HARNESS_LOAD_TIMEOUT=120 (field added by main)', c('bad', 'PT0.12S, silent'), c('ok', 'PT2M + warning'), c('ok', 'PT2M + warning')],
]
page('06-sweep-round7', 'Fig 6. Startup unit sweep at 8b690bef: what round 7 fixed and what is still open', SUB,
     table(['operator env', 'main', 'PR @ 8b690bef', 'candidate 2'], rows) +
     "<div class='note red'><b>R4-4 is a regression from round 7</b> (and from my round-1 candidate, which had the same shape): "
     "<code>implements EnvironmentAware</code> adds a public <code>setEnvironment</code>, so Spring Boot's binder treats "
     "<code>qwen.managed-agent.environment</code> as a property of type Environment, and any value under that key refuses the boot. "
     "Candidate 2 injects the Environment through a non-setter <code>@Autowired</code> method, accepts a leading +, skips 0 "
     "and prints the operator's own number in the hint. All 19 warnings on 8b690bef came from the shape branch; "
     "the magnitude bands (environment == null) never fired in a real boot (R4-1).</div>"
     "<pre>WARN qwen.managed-agent.harness.turn-deadline=+600000 binds as PT166H40M (seconds); before the @DurationUnit sweep\n"
     "     the same suffix-less value bound as milliseconds (PT10M). Write 600000ms to keep that meaning, or 600000s to\n"
     "     confirm the new one.                                                                      (candidate 2)</pre>")

rows = [
    ['TURN_DEADLINE=1800, 8 s Turn', c('bad', 'turn.failed hosted_turn_deadline_exceeded, 2.5 s'), c('ok', 'turn.completed, 9.1 s')],
    ['LEASE_DURATION=120, 2 Spring instances, 20 s Turn', c('bad', '2 owners, 6 retries, environment.failed, 34.0 s'),
     c('ok', '1 owner, 0 retries, 21.0 s')],
    ['materialize stalled 39.5 s (row lock)', c('bad', 'recovery scans during stall: 0'), c('ok', 'recovery scans during stall: 39')],
    ['5 x 1M chars (public create / events / WebShell submit)', c('bad', '202 / 202 / 202'), c('ok', '400 invalid_input x3')],
    ['100 x 1M chars', c('bad', '500 internal_error'), c('ok', '400 invalid_input')],
    ['metadata {clientId, other} on create / submit', c('bad', '400 / 400'), c('ok', '202 / 202, 0 markers stored')],
    ['WebShellTurn keys', 'turnId sessionId status submittedAt', 'identical'],
    ['prompt of 65,000 / 66,000 chars', 'completed / hosted_harness_rejected', 'identical'],
    ['official E2E: qwen3.8-max + --session-failover', '-', c('ok', 'pass / pass (no CLI_ENTRY)')],
    ['mvn verify (trial merge)', '-', c('ok', 'managed-agent-server 1278 + runtime-broker 736, 0 failures, spotbugs 0')],
    ['WebShell', '-', c('ok', 'regen diff 0, tsc ok, managed vitest 348/348')],
]
page('07-rerun-main-9a02f405', 'Fig 7. Every behavior re-run on the new main (9a02f405, with G3 Harness)', SUB.split(' &middot; candidate')[0] + '.',
     table(['probe', 'main 9a02f405', 'PR 8b690bef + main'], rows) +
     "<div class='note green'>All round-1 results reproduce on the new base: the unit fix, the dedicated materializer scheduler, "
     "the aggregate budget and the metadata contract behave the same, and the full chain still runs end to end.</div>")
print('ok')
