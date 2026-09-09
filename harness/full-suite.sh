#!/usr/bin/env bash
set -uo pipefail
WT=/root/git/pr11412; TEST=packages/web-shell/client/App.test.tsx; LOGS=/root/git/h11412/logs
cd "$WT"
for ver in base pr main; do
  git checkout HEAD -- "$TEST"; git reset -q HEAD -- "$TEST" 2>/dev/null
  case $ver in
    base) git checkout 1f890086f1a41e4de7965c44281116fd65b695d8 -- "$TEST";;
    main) git checkout origin/main -- "$TEST";;
  esac
  git reset -q HEAD -- "$TEST" 2>/dev/null
  echo "### full web-shell suite: ver=$ver ###"
  ( cd "$WT/packages/web-shell" && NO_COLOR=true npx vitest run --config vitest.config.ts ) > "$LOGS/full-$ver.log" 2>&1
  echo "ver=$ver rc=$?"
  grep -E '^ *(Test Files|Tests) ' "$LOGS/full-$ver.log" | tail -2
  grep -E '^ *FAIL ' "$LOGS/full-$ver.log" | sort -u | head -5
done
git checkout HEAD -- "$TEST"; git reset -q HEAD -- "$TEST" 2>/dev/null
echo "clean: $(git status --porcelain | wc -l) modified"
