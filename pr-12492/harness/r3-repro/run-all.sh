#!/bin/bash
# Re-run every reproduction against the head bundle (default) or another CLI:
#   ./run-all.sh                     # head: /root/verify/pr12492/head/dist/cli.js
#   CLI=$PWD/dist-fixed/cli.js LOGSUFFIX=.FIXED ./run-all.sh   # patched dist copy
# Every script runs inside `unshare -mn` (loopback only): no real endpoint is reachable.
cd /root/verify/pr12492/r3-repro
for s in r3-01-check-output-limit.mjs r3-02-incomplete-harvest-wedge.mjs r3-03-empty-batch-home.mjs \
         r3-04-delete-refused-wedge.mjs r3-05-06-refused-retry.mjs r3-08-download-404-wedge.mjs \
         r3-09-list-clean-skip-settings.mjs r3-10-wait-transient.mjs pomelo-list-skips-corrupt.mjs; do
  ./run-one.sh "$s" >/dev/null; echo "$s: $(tail -1 logs/${s%.mjs}${LOGSUFFIX:-}.log)"
done
./run-tls.sh r3-07-thinking-extra-body.mjs >/dev/null; echo "r3-07: $(tail -1 logs/r3-07-thinking-extra-body${LOGSUFFIX:-}.log)"
