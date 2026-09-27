#!/bin/bash
# Round-2 figure: base vs previous head (r1 = f5ba51ff) vs new head (r2 = 9088f00b).
export R=${SCRATCH:-/tmp/pr11959}/r2-fig
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
export ARMS="base r1 r2"
printf '\033[1;36m%s\033[0m\n' "PR #11959 round 2: base 1dbb3786 / r1 = f5ba51ff (previous report) / r2 = 9088f00b (autofix round 7)"
printf '\033[2m%s\033[0m\n\n' "real dist/cli.js per arm, isolated QWEN_HOME per cell, bundled snapshot only (QWEN_CODE_MODELS_DEV_REFRESH=off)"
printf '\033[1m%s\033[0m\n' "A) 'Context window' from qwen -p '/context -d'"
MODELS="claude-fable-5 qwen-flash claude-sonnet-4-5 deepseek-v3 deepseek-v3-0324 qwen3-coder-plus qwen-long gpt-4" $RIG/ctx-matrix.sh 2>/dev/null | node $RIG/colorize.mjs $RIG/notes-r2-ctx.json 12
echo
printf '\033[1m%s\033[0m\n' "B) max_tokens on the wire, nothing configured (main turn / memory-extraction turn)"
MODELS="deepseek-v3 deepseek-v3-0324 kimi-k2-thinking qvq-max glm-4.7" $RIG/out-matrix.sh r2fig-default 2>/dev/null | node $RIG/colorize.mjs $RIG/notes-r2-out-default.json 18
echo
printf '\033[1m%s\033[0m\n' "C) max_tokens on the wire, QWEN_CODE_MAX_OUTPUT_TOKENS=32768"
MODELS="qwq-32b Qwen/QwQ-32B kimi-k2-thinking" $RIG/out-matrix.sh r2fig-env 2>/dev/null --env QWEN_CODE_MAX_OUTPUT_TOKENS=32768 | node $RIG/colorize.mjs $RIG/notes-r2-out-explicit.json 18
echo; echo "[figure complete]"
