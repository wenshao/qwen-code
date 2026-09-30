#!/bin/sh
# VERIFICATION RIG ONLY: Notification Hook with a recipe env secret; stays alive 6 s so /proc can be inspected.
echo "{\"t\":$(date +%s%N),\"hook\":\"secret\",\"pid\":$$,\"secretEnv\":\"${RIG_SECRET:-}\"}" >> /lx/cmd/ledger.jsonl
sleep 6
printf '%s' '{}'
