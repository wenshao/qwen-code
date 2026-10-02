#!/bin/bash
# Clone node_modules from the pr13087 worktree (identical package-lock.json), then build + bundle at the PR head.
set -e
SRC=$HOME/git/qwen-code-pr13087; W=$HOME/git/qwen-code-pr13084
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
cd $W
echo "== clone node_modules $(date +%T)"
[ -d node_modules ] || cp -Rc $SRC/node_modules node_modules
for d in $SRC/packages/*/node_modules $SRC/packages/*/*/node_modules $SRC/integrations/*/node_modules; do
  [ -d "$d" ] || continue; rel=${d#$SRC/}; [ -e "$W/$rel" ] || { mkdir -p "$(dirname $W/$rel)"; cp -Rc "$d" "$W/$rel"; }
done
echo "== build $(date +%T)"; npm run build > /dev/null 2>&1 || { echo BUILD_FAILED; npm run build 2>&1 | tail -30; exit 1; }
echo "== bundle $(date +%T)"; npm run bundle > /dev/null 2>&1 || { echo BUNDLE_FAILED; exit 1; }
ls -la dist/cli.js; echo "== done $(date +%T) $(git rev-parse --short HEAD)"
