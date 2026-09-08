#!/usr/bin/env bash
# Usage: arm.sh <label> <treeish-or-'head'> [extra vitest args...]
set -uo pipefail
WT=/root/git/pr11406
F=packages/web-shell/client/App.test.tsx
LABEL="$1"; TREE="$2"; shift 2
cd "$WT"
git checkout HEAD -- "$F" packages/web-shell/client/App.tsx
if [ "$TREE" != "head" ]; then git checkout "$TREE" -- "$F"; fi
echo "### ARM $LABEL  (App.test.tsx from ${TREE})"
git diff --stat HEAD -- "$F" | tail -2
cd "$WT/packages/web-shell"
npx vitest run --config vitest.config.ts App.test.tsx -t "does not rerender App for other split sessions" "$@" 2>&1 | tail -40
cd "$WT" && git checkout HEAD -- "$F"
