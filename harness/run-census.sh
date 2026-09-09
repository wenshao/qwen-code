#!/usr/bin/env bash
set -uo pipefail
WT=/root/git/pr11412; TEST=packages/web-shell/client/App.test.tsx
cd "$WT"
for ver in pr main; do
  git checkout HEAD -- "$TEST"; git reset -q HEAD -- "$TEST" 2>/dev/null
  [ "$ver" = main ] && { git checkout origin/main -- "$TEST"; git reset -q HEAD -- "$TEST" 2>/dev/null; }
  python3 /root/git/h11412/harness/census.py >/dev/null
  echo "--- ver=$ver (rerender() present) ---"
  ( cd "$WT/packages/web-shell" && NO_COLOR=true npx vitest run client/App.test.tsx \
      -t "does not rerender App for other split sessions" --reporter=basic ) 2>&1 | grep -E '^\[CENSUS|Tests  ' | sed 's/^/  /'
done
git checkout HEAD -- "$TEST"; git reset -q HEAD -- "$TEST" 2>/dev/null
