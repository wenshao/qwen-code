#!/bin/zsh
# probe <serial> <method> [extra -e args...] ; prints QV12129R2 log lines
A=$RIG/emu/a
s=$1; m=$2; shift 2
$A $s logcat -c
out=$($A $s shell am instrument -w -r "$@" -e class com.qwen.mobileshell.ProbeR2Test#$m com.qwen.mobileshell.test/androidx.test.runner.AndroidJUnitRunner 2>&1)
echo "$out" | grep -E "^(OK|FAILURES)|stack=" | head -3
$A $s logcat -d -s QV12129R2:I | grep QV12129R2 | sed 's/.*QV12129R2: //'
