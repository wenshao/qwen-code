#!/bin/bash
# Hardlink the head tree's installed node_modules into the control worktree so
# the control arm resolves its own (base) sources, not head's.
set -x
A=/root/git/qwen-code-x3/tmp/pr12894-verify-20260928-205039
for d in node_modules packages/core/node_modules packages/cli/node_modules packages/web-shell/node_modules packages/acp-bridge/node_modules packages/browser-use/node_modules packages/sdk-typescript/node_modules; do
  if [ -e "$A/head/$d" ] && [ ! -e "$A/control/$d" ]; then cp -al "$A/head/$d" "$A/control/$d"; fi
done
echo CPAL_DONE
readlink -f "$A/control/node_modules/.bin/tsx"
ls "$A/control/packages/core/node_modules" | head -5
readlink -f "$A/control/packages/core/node_modules/strip-ansi"
