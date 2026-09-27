#!/bin/bash
# Figure 3: max_tokens the real CLI puts on the wire (fake OpenAI server ledger).
export R=${SCRATCH:-/tmp/pr11959}/r-fig
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
export ARMS="base pr cand"
export MODELS="glm-4.7 qwen-vl-max kimi-k2-thinking qvq-max qwq-32b Qwen/QwQ-32B deepseek-v3 deepseek-v3-0324"
printf '\033[1;36m%s\033[0m\n' "PR #11959: max_tokens on the wire for one real 'say hi' turn (request ledger of the repo's fake OpenAI server)"
printf '\033[2m%s\033[0m\n\n' "cand = PR + candidate patch (hasExplicitOutputLimit back to OUTPUT_PATTERNS only). Values: main turn / memory-extraction turn."
printf '\033[1m%s\033[0m\n' "A) nothing configured"
$RIG/out-matrix.sh fig-default 2>/dev/null | node $RIG/colorize.mjs $RIG/notes-out-default.json 18
echo
printf '\033[1m%s\033[0m\n' "B) user sets an explicit budget: QWEN_CODE_MAX_OUTPUT_TOKENS=32768"
MODELS="kimi-k2-thinking qvq-max qwq-32b Qwen/QwQ-32B glm-4.7" $RIG/out-matrix.sh fig-env 2>/dev/null --env QWEN_CODE_MAX_OUTPUT_TOKENS=32768 | node $RIG/colorize.mjs $RIG/notes-out-explicit.json 18
echo; echo "[figure complete]"
