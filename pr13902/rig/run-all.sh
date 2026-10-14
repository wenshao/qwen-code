#!/bin/bash
# Re-runs every scenario of the PR 13902 rig from scratch. bash only (no zsh).
set -u
ROOT=/Users/wenshao/git/pr13902-arms; RIG=$ROOT/rig; SH=$ROOT/shots
export PW_ROOT=/Users/wenshao/git/qwen-code
mkdir -p "$SH"
waitf() { for i in $(seq 1 $(( $2 * 4 ))); do [ -f "$1" ] && return 0; sleep 0.25; done; return 1; }
summ() { grep -E "^(PASS|FAIL|RESULT)" "$1"; }

echo "### S1 central A/B (+ live Web Shell shot on head)"
"$RIG/up.sh" head s1 43902 43910 | tail -1
R=$ROOT/runs/s1-head
PRE_HOLD=1 node "$RIG/s1-team-report.mjs" "$R" 43902 head > "$R/driver.log" 2>&1 &
DP=$!
waitf "$R/HOLD" 60 && node "$RIG/shot.mjs" --port 43902 --token "$(cat $R/token)" --session "$(jq -r .sessionId $R/HOLD)" --out "$SH/s1-live-head.png" --wait 4000 --release "$R/RELEASE" --after 9000 --expect 'joined the team||@correctness||LEADER-GOT-REPORT S1' --json "$SH/s1-live-head.json"
wait $DP; summ "$R/driver.log"; "$RIG/down.sh" "$R" >/dev/null
"$RIG/up.sh" base s1 43903 43911 | tail -1
R=$ROOT/runs/s1-base; node "$RIG/s1-team-report.mjs" "$R" 43903 base > "$R/driver.log" 2>&1; summ "$R/driver.log"; "$RIG/down.sh" "$R" >/dev/null
"$RIG/up.sh" cand s1 43907 43915 | tail -1
R=$ROOT/runs/s1-cand; node "$RIG/s1-team-report.mjs" "$R" 43907 head > "$R/driver.log" 2>&1; echo "(cand run with head expectations)"; summ "$R/driver.log"; "$RIG/down.sh" "$R" >/dev/null

echo "### S2/S3 approvals + R1-1 (head with wedge shot)"
"$RIG/up.sh" head s2 43902 43910 | tail -1
R=$ROOT/runs/s2-head
node "$RIG/s2-approval.mjs" "$R" 43902 head 150 > "$R/driver.log" 2>&1 &
DP=$!
waitf "$R/HOLD" 120 && node "$RIG/shot.mjs" --port 43902 --token "$(cat $R/token)" --session "$(jq -r .sessionId $R/HOLD)" --out "$SH/s3-wedge-head.png" --wait 6000 --expect 'requests write_file||Running WriteFile' --absent 'leader-S3.txt' --json "$SH/s3-wedge-head.json"
touch "$R/RELEASE"; wait $DP; summ "$R/driver.log"; "$RIG/down.sh" "$R" >/dev/null
"$RIG/up.sh" base s2 43903 43911 | tail -1
R=$ROOT/runs/s2-base; node "$RIG/s2-approval.mjs" "$R" 43903 base > "$R/driver.log" 2>&1; summ "$R/driver.log"; "$RIG/down.sh" "$R" >/dev/null
"$RIG/up.sh" cand s2 43907 43915 | tail -1
R=$ROOT/runs/s2-cand
node "$RIG/s2-approval.mjs" "$R" 43907 cand 150 > "$R/driver.log" 2>&1 &
DP=$!
waitf "$R/HOLD" 120 && node "$RIG/shot.mjs" --port 43907 --token "$(cat $R/token)" --session "$(jq -r .sessionId $R/HOLD)" --out "$SH/s3-both-pending-cand.png" --wait 6000 --expect 'requests write_file||leader-S3.txt' --json "$SH/s3-both-pending-cand.json"
touch "$R/RELEASE"; wait $DP; summ "$R/driver.log"; "$RIG/down.sh" "$R" >/dev/null

echo "### S4 subagent identity (R1-4)"
"$RIG/up.sh" head s4 43904 43912 | tail -1
R=$ROOT/runs/s4-head; node "$RIG/s4-subagent-identity.mjs" "$R" 43904 head > "$R/driver.log" 2>&1; summ "$R/driver.log"; echo "S4_SESSION $(grep -o '"id":"[0-9a-f-]*"' $R/driver.log | head -1)"
node "$RIG/shot.mjs" --port 43904 --token "$(cat $R/token)" --session "$(grep -o '"id":"[0-9a-f-]*"' $R/driver.log | head -1 | cut -d'"' -f4)" --out "$SH/s4-reloaded-panel-head.png" --wait 6000 --expect 'general-purpose||Explore' --json "$SH/s4-reloaded-panel-head.json"
"$RIG/down.sh" "$R" >/dev/null
"$RIG/up.sh" base s4 43905 43913 | tail -1
R=$ROOT/runs/s4-base; node "$RIG/s4-subagent-identity.mjs" "$R" 43905 base > "$R/driver.log" 2>&1; summ "$R/driver.log"; "$RIG/down.sh" "$R" >/dev/null

echo "### S5 close window (R1-2) on a raw ACP host"
"$RIG/run-s5.sh" load head s5acp-load-head
"$RIG/run-s5.sh" control head s5acp-control-head
"$RIG/run-s5.sh" loadfix cand s5acp-loadfix-cand
echo "### ALL DONE"
