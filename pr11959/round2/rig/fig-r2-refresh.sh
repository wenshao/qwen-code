#!/bin/bash
# Round-2 figure: F1 fix, the new empty-cache heal guard, and the near-empty residual.
export R=${SCRATCH:-/tmp/pr11959}/r2-fig
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
color() { sed -E $'s/^(== .*)$/\033[1m\\1\033[0m/; s/(models=0|models=1 |= 200\\.0k)/\033[31;1m\\1\033[0m/g; s/(models=194)/\033[32m\\1\033[0m/g; s/(byte-identical after 500: yes)/\033[32m\\1\033[0m/'; }
printf '\033[1;36m%s\033[0m\n' "PR #11959 round 2 (r2 = 9088f00b): models.dev refresh through the real CLI, local mirror of the real api.json"
echo
printf '\033[1m%s\033[0m\n' "1) F1 on r2: same six-start lifecycle as round 1, steps 4-6 (/foreign = 200 {\"message\":\"Missing Authentication Token\"})"
CLI=/Users/wenshao/git/qwen-11959-r2/dist/cli.js SUFFIX=-r2 $RIG/refresh-lifecycle.sh 2>/dev/null | sed -n '/== 4/,$p' | grep -v "^  last:" | color
echo
printf '\033[1m%s\033[0m\n' "2) New heal guard: cache poisoned by r1 while /flip served the error body; /flip then recovers (same URL, <24h)"
$RIG/heal.sh 2>/dev/null | sed -E 's/  last: .*"flip":"([a-z]+)".*"status":([0-9]+).*/  last: flip=\1 status=\2/; s/ fetchedAt=[^ ]*//' | color
echo
printf '\033[1m%s\033[0m\n' "3) Residual: a 200 whose projection is non-empty but tiny (/partial = one model) still replaces the whole catalog"
$RIG/partial.sh 2>/dev/null | color
echo; echo "[figure complete]"
