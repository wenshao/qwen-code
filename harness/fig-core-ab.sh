#!/usr/bin/env bash
# Real CoreToolScheduler (built dist) + real Config + real tools, base vs PR.
cd /root/git/h11483
B=$'\e[1m'; R=$'\e[0m'; RED=$'\e[91m'; GRN=$'\e[92m'; YEL=$'\e[93m'; CYA=$'\e[96m'; DIM=$'\e[2m'
line() { printf '%s\n' "${DIM}────────────────────────────────────────────────────────────────────────────────────────────────${R}"; }
echo "${B}${CYA}PR #11483 — R1: real CoreToolScheduler from built dist, real Config, real tools${R}"
echo "${DIM}batch A holds the scheduler busy; batch B is scheduled with a signal aborted BEFORE schedule()${R}"
line
for mode in approval executing; do
  if [ "$mode" = approval ]; then
    echo "${B}${YEL}HOLD = write_file parked in awaiting_approval  (unbounded: only a user answer releases it)${R}"
  else
    echo "${B}${YEL}HOLD = run_shell_command parked in executing  (node -e 'setTimeout(...600s)')${R}"
  fi
  for wt in base11483 pr11483; do
    tag=$([ "$wt" = base11483 ] && echo "${RED}base 10895031e2${R}" || echo "${GRN}PR   5ab8312f3f${R}")
    out=$(node r1-core-real.mjs /root/git/$wt "$mode" 6000 0 2>/dev/null)
    printf '  %b\n' "$tag"
    echo "$out" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('    B scheduled at t+%dms, observed for %dms' % (d['bScheduledAtMs'], d['observeMs']))
print('    B outcome      : %s' % d['bOutcomeAtObserve'])
print('    B settled after: %s ms' % d['bSettledAtMsFromSchedule'])
print('    requestQueue   : %s entr(y/ies) still parked' % d['requestQueueLengthAtObserve'])
print('    completions    : %s' % (d['completionsAtObserve'] or 'none'))
"
  done
  line
done
echo "${B}Base: B stays ${RED}pending${R}${B} in the queue behind an unrelated batch.  PR: B is ${GRN}rejected in 0 ms${R}${B} and never enters the queue.${R}"
