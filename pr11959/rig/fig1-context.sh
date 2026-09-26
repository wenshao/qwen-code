#!/bin/bash
# Figure 1: context window the real CLI reports in `/context -d`, per model and arm.
export R=${SCRATCH:-/tmp/pr11959}/r-fig
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
printf '\033[1;36m%s\033[0m\n' "PR #11959 @ f5ba51ff vs base 1dbb3786: 'Context window' printed by the real CLI (qwen -p '/context -d')"
printf '\033[2m%s\033[0m\n\n' "isolated QWEN_HOME per cell, QWEN_CODE_MODELS_DEV_REFRESH=off (bundled snapshot only); pr-catalog-off = PR bundle + QWEN_CODE_MODELS_DEV=off"
$RIG/ctx-matrix.sh 2>/dev/null | node $RIG/colorize.mjs $RIG/notes-ctx.json 12
echo; echo "[figure complete]"
