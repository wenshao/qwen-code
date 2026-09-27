#!/bin/bash
# Round-3 figure: max_tokens on the wire, base3 / r2 / r3 (fake OpenAI server ledger).
export R=${SCRATCH:-/tmp/pr11959}/r3-fig
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
export ARMS="base3 r2 r3"
export MODELS="kimi-k2-thinking qvq-max qwq-32b Qwen/QwQ-32B glm-4.7 qwen-vl-max"
printf '\033[1;36m%s\033[0m\n' "PR #11959 round 3: max_tokens on the wire for one real 'say hi' turn (request ledger of the repo's fake OpenAI server)"
printf '\033[2m%s\033[0m\n\n' "base3 = merge-base 700620f4, r2 = 9088f00b (round 2), r3 = 1bb0e56e. Values: main turn / memory-extraction turn."
printf '\033[1m%s\033[0m\n' "A) nothing configured"
$RIG/out-matrix.sh r3fig-default 2>/dev/null | node $RIG/colorize.mjs $RIG/notes-r3-default.json 18
echo
printf '\033[1m%s\033[0m\n' "B) QWEN_CODE_MAX_OUTPUT_TOKENS=32768"
$RIG/out-matrix.sh r3fig-env 2>/dev/null --env QWEN_CODE_MAX_OUTPUT_TOKENS=32768 | node $RIG/colorize.mjs $RIG/notes-r3-explicit.json 18
echo; echo "[figure complete]"
