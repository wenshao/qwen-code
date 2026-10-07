# VERIFICATION RIG ONLY (PR #13536): candidate witness cases for the shared H6a fixture
# (textual insertion keeps the file's prettier layout; every new case names its refusal clause).
import json, sys
P = sys.argv[1]
s = open(P).read()
D9 = '9' * 64
CASES = [
 {"id": "schedule-run-with-effect", "domain": "schedule", "patch": {"run": {"effectId": "effect-1"}}, "valid": False, "start": False, "error": "must stay a purely logical lifecycle"},
 {"id": "schedule-run-with-dispatch", "domain": "schedule", "patch": {"run": {"dispatchId": "claim-1"}}, "valid": False, "start": False, "error": "must stay a purely logical lifecycle"},
 {"id": "schedule-run-with-session-delivery", "domain": "schedule", "patch": {"run": {"delivery": {"target": "session", "state": "planned"}}}, "valid": False, "start": False, "error": "must stay a purely logical lifecycle"},
 {"id": "cron-range-equal-ends", "domain": "schedule", "patch": {"cron": "5-5 * * * *"}, "valid": False, "start": False, "error": "ranges must not wrap"},
 {"id": "cron-day-of-month-zero", "domain": "schedule", "patch": {"cron": "0 0 0 * *"}, "valid": False, "start": False, "error": "values must stay within 1-31"},
 {"id": "cron-month-over-max", "domain": "schedule", "patch": {"cron": "0 0 * 13 *"}, "valid": False, "start": False, "error": "values must stay within 1-12"},
 {"id": "cron-day-of-week-over-max", "domain": "schedule", "patch": {"cron": "0 0 * * 8"}, "valid": False, "start": False, "error": "values must stay within 0-7"},
 {"id": "cron-upper-bounds", "domain": "schedule", "patch": {"cron": "59 23 31 12 7"}, "valid": True, "start": True},
 {"id": "timezone-three-segments", "domain": "schedule", "patch": {"timezone": "America/Argentina/Buenos_Aires"}, "valid": True, "start": True},
 {"id": "timezone-four-segments", "domain": "schedule", "patch": {"timezone": "America/Argentina/Buenos_Aires/X"}, "valid": False, "start": False, "error": "IANA timezone name form"},
 {"id": "slot-leap-second", "domain": "automation_run", "patch": {"occurrenceKey": "schedule:2016-12-31T23:59:60Z"}, "valid": False, "start": False, "error": "slot must be a canonical UTC instant"},
 {"id": "slot-hour-24", "domain": "automation_run", "patch": {"occurrenceKey": "schedule:2026-10-06T24:00:00Z"}, "valid": False, "start": False, "error": "slot must be a canonical UTC instant"},
 {"id": "manual-empty-command", "domain": "automation_run", "patch": {"occurrenceKey": "manual:"}, "valid": False, "start": False, "error": "commandId must be a non-empty string"},
]
SUCC = [
 {"id": "schedule-run-moves-back", "domain": "schedule", "before": {"run": {"state": "running"}}, "after": {"definitionRevision": 2, "definitionDigest": D9}, "valid": False},
 {"id": "run-fixed-schedule", "domain": "automation_run", "before": {}, "after": {"scheduleId": "schedule-2"}, "valid": False},
]
if len(sys.argv) > 2 and sys.argv[2] == 'with-goal-order':
    CASES.append({"id": "goal-oversize-with-control", "domain": "schedule", "patch": {"goal": "x" * 4097 + "\u0001"}, "valid": False, "start": False, "error": "exceeds 4096 UTF-8 bytes"})
def block(items):
    return ''.join(',\n' + '\n'.join('    ' + l for l in json.dumps(i, indent=2, ensure_ascii=True).splitlines()) for i in items)
a = '\n  ],\n  "successors": ['
assert s.count(a) == 1 and s.endswith('\n  ]\n}\n')
s = s.replace(a, block(CASES) + a)
s = s[:-len('\n  ]\n}\n')] + block(SUCC) + '\n  ]\n}\n'
json.loads(s)
open(P, 'w').write(s)
print('cases', len(CASES), 'successors', len(SUCC))
