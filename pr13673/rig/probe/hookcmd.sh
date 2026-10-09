#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673): command Hook recorder. usage (as the Hook command): hookcmd.sh <rec.jsonl> <ctl-dir>
# Appends one JSON line per invocation (event, session, pid, boot id, cgroup). If <ctl-dir>/hang-<event> exists, it
# records an "enter" line and then blocks forever (an End whose outcome stays unknown when its worker disappears).
REC=$1; CTL=$2
in=$(cat)
ev=$(printf '%s' "$in" | grep -o '"hook_event_name" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
sid=$(printf '%s' "$in" | grep -o '"session_id" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
line() { printf '{"t":"%s","phase":"%s","event":"%s","session":"%s","pid":%d,"ppid":%d,"boot":"%s","cwd":"%s","cgroup":"%s"}\n' \
  "$(date -u +%FT%T.%3NZ)" "$1" "$ev" "$sid" $$ $PPID "$(cat /proc/sys/kernel/random/boot_id)" "$PWD" "$(cat /proc/self/cgroup | tr -d '\n')" >> "$REC"; }
if [ -e "$CTL/hang-$ev" ]; then line enter; while :; do sleep 3600; done; fi
line ran
exit 0
