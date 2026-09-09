#!/usr/bin/env bash
# Arm runner: (test-file version) x (mutation), each a REAL vitest run in the PR worktree.
set -uo pipefail
WT=/root/git/pr11412
TEST=packages/web-shell/client/App.test.tsx
APP=packages/web-shell/client/App.tsx
LOGS=/root/git/h11412/logs
FILTER='does not rerender App for other split sessions'
mkdir -p "$LOGS"

restore() { cd "$WT"; git checkout HEAD -- "$TEST" "$APP"; git reset -q HEAD -- "$TEST" "$APP" 2>/dev/null; }

run_arm() { # $1=name $2=test-version(base|pr|main) $3=mutation(none|...)
  local name=$1 ver=$2 mut=$3 log="$LOGS/arm-$1.log"
  restore
  cd "$WT"
  case "$ver" in
    base) git checkout 1f890086f1a41e4de7965c44281116fd65b695d8 -- "$TEST" ;;
    main) git checkout origin/main -- "$TEST" ;;
    pr)   : ;;
  esac
  git reset -q HEAD -- "$TEST" 2>/dev/null
  local mdesc='(none)'
  if [ "$mut" != none ]; then
    mdesc=$(python3 /root/git/h11412/harness/mutate.py "$mut") || { echo "MUTATE-FAILED $name"; restore; return; }
  fi
  ( cd "$WT/packages/web-shell" && npx vitest run client/App.test.tsx -t "$FILTER" --reporter=basic ) > "$log" 2>&1
  local rc=$?
  local tests
  tests=$(grep -E '^ *Tests +' "$log" | tail -1 | sed 's/^ *//')
  local err
  err=$(grep -m1 -E 'ReferenceError|AssertionError|expected .* to' "$log" | sed 's/^ *//' | cut -c1-96)
  printf '%-34s | %-4s | %-24s | rc=%-2s | %-34s | %s\n' "$name" "$ver" "$mut" "$rc" "${tests:-<no tally>}" "${err:-}"
  restore
}

echo "arm                                | ver  | mutation                 | rc   | tally                              | first error"
echo "-----------------------------------+------+--------------------------+------+------------------------------------+------------"
run_arm "1-base-nightly-tree"        base none
run_arm "2-pr11412-head"             pr   none
run_arm "3-main-after-11406"         main none
run_arm "4-pr+drop-rerender"         pr   drop-rerender
run_arm "5-main+drop-rerender"       main drop-rerender
run_arm "6-pr+prod-owner-filter"     pr   prod-drop-owner-filter
run_arm "7-main+prod-owner-filter"   main prod-drop-owner-filter
run_arm "8-pr+prod-always-rerender"  pr   prod-always-rerender
run_arm "9-main+prod-always-rerender" main prod-always-rerender
run_arm "10-main+clear-to-reset"     main clear-to-reset
echo
cd "$WT" && echo "worktree clean check:" && git status --porcelain
