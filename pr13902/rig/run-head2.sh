#!/bin/bash
# Re-runs the scenarios on the new PR head 309106ee (arm dir: head2). bash only.
set -u
ROOT=/Users/wenshao/git/pr13902-arms; RIG=$ROOT/rig; SH=$ROOT/shots
export PW_ROOT=/Users/wenshao/git/qwen-code
waitf() { for i in $(seq 1 $(( $2 * 4 ))); do [ -f "$1" ] && return 0; sleep 0.25; done; return 1; }
summ() { grep -E "^(PASS|FAIL|RESULT)" "$1"; }
echo "### S1 head2"
"$RIG/up.sh" head2 s1 43902 43910 | tail -1
R=$ROOT/runs/s1-head2; node "$RIG/s1-team-report.mjs" "$R" 43902 head > "$R/driver.log" 2>&1; summ "$R/driver.log"; "$RIG/down.sh" "$R" >/dev/null
echo "### S2/S3 head2"
"$RIG/up.sh" head2 s2 43902 43910 | tail -1
R=$ROOT/runs/s2-head2
node "$RIG/s2-approval.mjs" "$R" 43902 head2 150 > "$R/driver.log" 2>&1 &
DP=$!
waitf "$R/HOLD" 120 && node "$RIG/shot.mjs" --port 43902 --token "$(cat $R/token)" --session "$(jq -r .sessionId $R/HOLD)" --out "$SH/s3-both-pending-head2.png" --wait 6000 --expect 'requests write_file' --json "$SH/s3-both-pending-head2.json"
touch "$R/RELEASE"; wait $DP; summ "$R/driver.log"; "$RIG/down.sh" "$R" >/dev/null
echo "### S4 head2"
"$RIG/up.sh" head2 s4 43904 43912 | tail -1
R=$ROOT/runs/s4-head2; node "$RIG/s4-subagent-identity.mjs" "$R" 43904 head2 > "$R/driver.log" 2>&1; summ "$R/driver.log"; grep -A8 "subagent_type" "$R/driver.log" | head -10; "$RIG/down.sh" "$R" >/dev/null
echo "### S5 head2 (raw ACP)"
"$RIG/run-s5.sh" loadfix head2 s5acp-loadfix-head2
"$RIG/run-s5.sh" control head2 s5acp-control-head2
echo "### S6 head2 designated"
"$RIG/up.sh" head2 s6 43908 43916 ',"policy":{"permissionStrategy":"designated"}' | tail -1
R=$ROOT/runs/s6-head2; node "$RIG/s6-designated.mjs" "$R" 43908 > "$R/driver.log" 2>&1; summ "$R/driver.log"; "$RIG/down.sh" "$R" >/dev/null
echo "### S7 head2 team_delete with pending teammate approval"
"$RIG/up.sh" head2 s7 43909 43917 | tail -1
R=$ROOT/runs/s7-head2
node "$RIG/s7-team-delete.mjs" "$R" 43909 head2 120 > "$R/driver.log" 2>&1 &
DP=$!
waitf "$R/HOLD" 120 && node "$RIG/shot.mjs" --port 43909 --token "$(cat $R/token)" --session "$(jq -r .sessionId $R/HOLD)" --out "$SH/s7-after-delete-head2.png" --wait 6000 --expect 'requests write_file||LEADER-DELETED' --json "$SH/s7-after-delete-head2.json"
touch "$R/RELEASE"; wait $DP; summ "$R/driver.log"; "$RIG/down.sh" "$R" >/dev/null
echo "### HEAD2 DONE"
