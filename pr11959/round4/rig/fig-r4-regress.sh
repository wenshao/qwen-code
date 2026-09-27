#!/bin/bash
# Round-4 figure: earlier fixes and open items re-checked on r4.
export R=${SCRATCH:-/tmp/pr11959}/r4-fig
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
. $RIG/arms.sh
color() { sed -E $'s/^(== .*)$/\033[1m\\1\033[0m/; s/(models=1 |= 200\\.0k|cache <none>)/\033[33;1m\\1\033[0m/g; s/(models=194)/\033[32m\\1\033[0m/g; s/^(r4 +project[^ ]* +)(requests-to-planted-host=0)/\\1\033[32;1m\\2\033[0m/; s/(global-cache=planted)/\033[33m\\1\033[0m/'; }
printf '\033[1;36m%s\033[0m\n' "PR #11959 round 4 (r4 = 4d9bbdef): earlier fixes and open items, real CLI"
echo
printf '\033[1m%s\033[0m\n' "F1: lifecycle steps 5-6 (/foreign = 200 with a gateway error body)"
CLI=$R4 SUFFIX=-r4 $RIG/refresh-lifecycle.sh 2>/dev/null | sed -n '/== 5/,$p' | grep -v "^  last:\|mirror requests" | color
echo
printf '\033[1m%s\033[0m\n' "F2: channels that can set QWEN_CODE_MODELS_DEV_URL"
CHANNEL_ARMS=r4 $RIG/projenv-channels.sh 2>/dev/null | grep . | color
echo
printf '\033[1m%s\033[0m\n' "F3: QWEN_CODE_MAX_OUTPUT_TOKENS=32768, wire max_tokens (main turn / memory turn)"
ARMS="base3 r4" MODELS="qwq-32b Qwen/QwQ-32B kimi-k2-thinking glm-4.7" $RIG/out-matrix.sh r4fig-env 2>/dev/null --env QWEN_CODE_MAX_OUTPUT_TOKENS=32768
echo
printf '\033[1m%s\033[0m\n' "Open: near-empty projection (/partial) and one null entry (/nullentry)"
PARTIAL_ARM=r4 $RIG/partial.sh 2>/dev/null | color
ARM=r4 $RIG/nullentry.sh 2>/dev/null | color
echo; echo "[figure complete]"
