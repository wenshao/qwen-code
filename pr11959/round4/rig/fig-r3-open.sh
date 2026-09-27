#!/bin/bash
# Round-3 figure: open items measured on r3.
export R=${SCRATCH:-/tmp/pr11959}/r3-fig
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
color() { sed -E $'s/^(== .*)$/\033[1m\\1\033[0m/; s/(models=1 |= 200\\.0k|cache <none>)/\033[33;1m\\1\033[0m/g; s/(models=194)/\033[32m\\1\033[0m/g'; }
printf '\033[1;36m%s\033[0m\n' "PR #11959 round 3 (r3 = 1bb0e56e): open items, measured through the real CLI"
echo
printf '\033[1m%s\033[0m\n' "1) Near-empty projection: a 200 carrying one model (/partial) still replaces the whole catalog"
PARTIAL_ARM=r3 $RIG/partial.sh 2>/dev/null | color
echo
printf '\033[1m%s\033[0m\n' "2) One null model entry in the real payload (/nullentry): the whole refresh fails and is retried every start"
$RIG/nullentry.sh 2>/dev/null | color
echo
printf '\033[1m%s\033[0m\n' "3) Catalog peer accepts and never answers (/hang): does 'qwen -p' wait for the 10 s fetch timeout?"
$RIG/hang.sh 2>$R/hang-stderr.log
echo; echo "[figure complete]"
