#!/bin/bash
set -u
ROOT=/Users/wenshao/git/pr13902-arms; RIG=$ROOT/rig; SH=$ROOT/shots; export PW_ROOT=/Users/wenshao/git/qwen-code
waitf() { for i in $(seq 1 $(( $2 * 4 ))); do [ -f "$1" ] && return 0; sleep 0.25; done; return 1; }
"$RIG/up.sh" head2 s7nv 43909 43917 | tail -1
R=$ROOT/runs/s7nv-head2
S7_NOVOTE=1 node "$RIG/s7-team-delete.mjs" "$R" 43909 head2 1 > "$R/driver.log" 2>&1 &
DP=$!
waitf "$R/HOLD2" 120 && node "$RIG/shot.mjs" --port 43909 --token "$(cat $R/token)" --session "$(jq -r .sessionId $R/HOLD2)" --out "$SH/s7-dead-card-in-front-head2.png" --wait 6000 --expect 'requests write_file||leader-S7c.txt' --json "$SH/s7-dead-card-in-front-head2.json"
touch "$R/RELEASE2"; wait $DP; grep -E "^(PASS|FAIL|RESULT)" "$R/driver.log"; "$RIG/down.sh" "$R" >/dev/null
