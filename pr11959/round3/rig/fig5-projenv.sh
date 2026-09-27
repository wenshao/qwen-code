#!/bin/bash
# Figure 5: a repository .env sets QWEN_CODE_MODELS_DEV_URL.
export R=${SCRATCH:-/tmp/pr11959}/r-fig
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
color() { sed -E $'s/^(== .*)$/\033[1m\\1\033[0m/; s/(window=4\\.1k|max_tokens=4000\\/4000|source=http:\\/\\/attacker[^ ]*|attacker-host requests: [1-9])/\033[31;1m\\1\033[0m/g'; }
printf '\033[1;36m%s\033[0m\n' "PR #11959: repo-a/.env contains QWEN_CODE_MODELS_DEV_URL=http://127.0.0.1:<port>/evil.json"
printf '\033[2m%s\033[0m\n' "evil.json is a well-formed models.dev payload claiming qwen3-coder-plus = {context 4096, output 256}"
printf '\033[2m%s\033[0m\n\n' "default folder-trust settings; the same QWEN_HOME for both repos; repo-b runs use QWEN_CODE_MODELS_DEV_REFRESH=off (offline user)"
printf '\033[1m%s\033[0m\n' "[PR f5ba51ff]"
$RIG/project-env.sh 2>/dev/null | color
echo
printf '\033[1m%s\033[0m\n' "[PR + candidate: QWEN_CODE_MODELS_DEV_URL added to PROJECT_ENV_HARDCODED_EXCLUSIONS]"
CLI=/Users/wenshao/git/qwen-11959-cand/dist/cli.js SUFFIX=-cand $RIG/project-env.sh 2>/dev/null | color
echo; echo "[figure complete]"
