#!/bin/bash
# Round-2 figure: F2 across every channel that can set QWEN_CODE_MODELS_DEV_URL.
export R=${SCRATCH:-/tmp/pr11959}/r2-fig
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
color() { sed -E $'s/^(r2 +project[^ ]* +)(requests-to-planted-host=0)/\\1\033[32;1m\\2\033[0m/; s/^(r1 +project[^ ]* +)(requests-to-planted-host=1)/\\1\033[31;1m\\2\033[0m/; s/(global-cache=planted)/\033[33m\\1\033[0m/'; }
printf '\033[1;36m%s\033[0m\n' "PR #11959 round 2: who can still point the catalog download at another host? (r1 = f5ba51ff, r2 = 9088f00b)"
printf '\033[2m%s\033[0m\n\n' "each cell: fresh QWEN_HOME, one real 'say hi' turn with qwen3-coder-plus, default folder-trust settings; planted host = local evil.json"
$RIG/projenv-channels.sh 2>/dev/null | color
printf '\033[2m%s\033[0m\n' "project-* = files inside the repository; user-* = \$QWEN_HOME/.env and user settings.json env; shell = launch environment"
echo; echo "[figure complete]"
