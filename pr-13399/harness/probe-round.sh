#!/bin/bash
# Settle-time probe under a CPU quota: every test that calls requested(), probe
# arm (PR head + 50ms poll recording visible/await_action), main-CI config, no retry.
# Usage: probe-round.sh <round> <quota...>
R=$1; shift; OUT=/root/verify/pr13399/runs/probe; mkdir -p $OUT
H=/root/verify/pr13399/harness/throttle-run.sh
PAT=$(cat /root/verify/pr13399/harness/approval-tests.regex)
for q in "$@"; do
  rm -f $OUT/q$q-r$R.jsonl
  RETRY=0 $H $q src/serve/hosted-workspace-tool-turn.armprobe.test.ts "$PAT" $OUT/q$q-r$R.log PR13399_PROBE_OUT=$OUT/q$q-r$R.jsonl &
done
wait
