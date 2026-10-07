#!/bin/bash
# Watch the user Turn on S2 vs the c1 automation until the Turn ends (max 15 min).
S2=$(cat runs/h1/S2); T=turn_2656393e779e4e02bc9e89f45af696d2
for i in $(seq 180); do
  st=$(./mysql.sh sql -N h1 -e "select status from managed_agent_turn where turn_id='$T'")
  echo "$(date -u +%T) user-turn=$st"
  case "$st" in COMPLETED|FAILED|CANCELLED) break;; esac
  sleep 5
done
