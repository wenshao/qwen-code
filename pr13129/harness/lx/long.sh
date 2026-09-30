#!/bin/sh
# VERIFICATION RIG ONLY: long-running Notification Hook with a child that ignores TERM.
echo "{\"t\":$(date +%s%N),\"hook\":\"long\",\"pid\":$$,\"cgroup\":\"$(cat /proc/self/cgroup | tr -d '\n')\"}" >> /lx/cmd/ledger.jsonl
sh -c 'trap "" TERM; echo $$ > /lx/cmd/stubborn.pid; while :; do sleep 1; done' &
sleep 120
