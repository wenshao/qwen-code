#!/bin/bash
# Figure 4: background refresh lifecycle through the real CLI against a local models.dev mirror.
export R=${SCRATCH:-/tmp/pr11959}/r-fig
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
color() { sed -E $'s/^(== .*)$/\033[1m\\1\033[0m/; s/(models=0)/\033[31;1m\\1\033[0m/; s/(= 200\\.0k)/\033[31;1m\\1\033[0m/; s/(status":304)/\033[32m\\1\033[0m/; s/(byte-identical after 500: yes)/\033[32m\\1\033[0m/; s/(requests so far: +1)$/\\1/'; }
printf '\033[1;36m%s\033[0m\n' "PR #11959 @ f5ba51ff: models.dev refresh lifecycle, one QWEN_HOME across six real CLI starts"
printf '\033[2m%s\033[0m\n' "QWEN_CODE_MODELS_DEV_URL -> local mirror serving the real 4.9 MB api.json (ETag); cache = \$QWEN_HOME/model-registry.json"
printf '\033[2m%s\033[0m\n\n' "step 3 ages the cache by 25h; /foreign answers 200 {\"message\":\"Missing Authentication Token\"}"
$RIG/refresh-lifecycle.sh 2>/dev/null | color
echo
printf '\033[1;36m%s\033[0m\n' "Same steps 5-6 with the candidate patch (reject a 200 whose projection is empty):"
CLI=/Users/wenshao/git/qwen-11959-cand/dist/cli.js SUFFIX=-cand $RIG/refresh-lifecycle.sh 2>/dev/null | sed -n '/== 5/,$p' | color
echo; echo "[figure complete]"
