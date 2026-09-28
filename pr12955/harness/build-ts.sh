#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fc30c1c3-658a-459a-9a85-13701a898397/scratchpad
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
for W in "$@"; do
  cd $SP/$W || exit 1
  [ -d node_modules/ink ] || { (corepack pnpm install --frozen-lockfile --offline --ignore-scripts) > $SP/logs/$W-pnpm.log 2>&1; echo "$W pnpm rc=$?"; }
  npx patch-package > $SP/logs/$W-patch.log 2>&1; echo "$W patch rc=$?"
  (time (npm run build && npm run bundle)) > $SP/logs/$W-build.log 2>&1; echo "$W build rc=$?"
  ls -la $SP/$W/dist/cli.js
done
echo TS_DONE
