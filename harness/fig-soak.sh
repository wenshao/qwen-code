#!/usr/bin/env bash
# 200 pre-aborted schedule() calls against a busy real scheduler.
cd /root/git/h11483
B=$'\e[1m'; R=$'\e[0m'; RED=$'\e[91m'; GRN=$'\e[92m'; CYA=$'\e[96m'; DIM=$'\e[2m'
echo "${B}${CYA}PR #11483 — R6: 200 pre-aborted requests while a real tool is executing${R}"
echo "${DIM}real Config + real run_shell_command hold; each request gets its own already-aborted AbortController${R}"
echo
for wt in base11483 pr11483; do
  tag=$([ "$wt" = base11483 ] && echo "${RED}base 10895031e2${R}" || echo "${GRN}PR   5ab8312f3f${R}")
  printf '  %b\n' "$tag"
  node r6-soak.mjs /root/git/$wt 200 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
o=d['outcomes']
print('    rejected immediately  : %d / %d' % (o['rejected'], d['N']))
print('    resolved late         : %d / %d' % (o['resolved'], d['N']))
print('    requestQueue peak     : %d' % d['queueLengthDuringBurst'])
print('    onAllToolCallsComplete: %d batch(es)  (%d of them a late \"cancelled\")' % (d['completionBatches'], d['cancelledCompletions']))
print('    active batch outcome  : %s (hold:success)' % d['holdBatch'])
print('    unhandled rejections  : %d' % d['unhandledRejections'])
"
done
echo
echo "${B}Base replays 200 stale ${RED}cancelled${R}${B} completions into the caller after the active tool finishes; the PR emits none.${R}"
