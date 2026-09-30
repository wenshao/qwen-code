#!/bin/bash
# usage: build-ts.sh <wt>...   (VERIFICATION RIG ONLY)
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/c7d2ab96-3862-4fe9-966f-d80da045ac10/scratchpad
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
for W in "$@"; do
  cd $SP/$W || exit 1
  [ -d node_modules/ink ] || { (corepack pnpm install --frozen-lockfile --offline --ignore-scripts) > $SP/logs/$W-pnpm.log 2>&1; echo "$W pnpm rc=$?"; }
  npx patch-package > $SP/logs/$W-patch.log 2>&1; echo "$W patch rc=$?"
  (time (npm run build && npm run bundle)) > $SP/logs/$W-build.log 2>&1; echo "$W build rc=$?"
  ls -la $SP/$W/dist/cli.js
done
echo TS_DONE
