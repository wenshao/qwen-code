#!/usr/bin/env bash
# PR #9273 round 2 — the three touched suites at 0b51eef6c6: as root, and as
# uid 1000 (user namespace, no caps) with /tmp/tmux-1000 absent — the
# finding-2 shape from round 1.
set -u
WT=/root/verify/pr9273/head/packages/cli
L=/root/verify/pr9273/e2e/r2/logs; mkdir -p $L
NS="unshare --user --map-user=1000 --map-group=1000"
SUITES="src/commands/review/capture-tui.test.ts src/commands/review/cleanup.test.ts src/commands/review/lib/tui-capture.test.ts"
H() { printf '\n\033[1;36m━━ %s\033[0m\n' "$*"; }
C() { printf '\033[2m$ %s\033[0m\n' "$*"; }
tally() { sed 's/\x1b\[[0-9;]*m//g' "$1" | grep -E '^\s+(Test Files|Tests) ' | tr -s ' ' | sed 's/^ /  /'; }
cd $WT
printf '\033[1mPR #9273 round 2 — unit suites\033[0m  head=%s  node=%s  tmux=%s\n' "$(git rev-parse --short=10 HEAD)" "$(node -v)" "$(tmux -V)"

H "U1  three touched suites, root"
C "vitest run capture-tui.test.ts cleanup.test.ts lib/tui-capture.test.ts"
CI=true npx vitest run $SUITES > $L/unit-root.log 2>&1; echo "  exit=$?"
tally $L/unit-root.log

H "U2  same suites as uid 1000 with /tmp/tmux-1000 ABSENT (round-1 finding 2 shape)"
rm -rf /tmp/tmux-1000
C "ls -ld /tmp/tmux-1000"; ls -ld /tmp/tmux-1000 2>&1 | sed 's/^/  /'
C "unshare --user --map-user=1000 vitest run …"
CI=true $NS npx vitest run $SUITES > $L/unit-uid1000-absent.log 2>&1; echo "  exit=$?"
tally $L/unit-uid1000-absent.log
printf '  "unsafe permissions" refusals in the log: %s\n' "$(grep -c 'has unsafe permissions' $L/unit-uid1000-absent.log)"
printf '  /tmp/tmux-1000 afterwards: %s\n' "$($NS stat -c '%A' /tmp/tmux-1000 2>&1)"

H "U3  each of the five real-host fixtures ALONE, dir absent, uid 1000"
F=src/commands/review/capture-tui.test.ts
for t in \
  'visits a base once even when two candidate strings name it' \
  'a fallback kill that reaped through /tmp does not warn' \
  'a swapped socket at the fallback name keeps the orphan WARNING' \
  'an unstamped run never connects or unlinks an entry at its unique name on ANOTHER base' \
  'never connects the kill on another base when a stamp proves the bind'; do
  rm -rf /tmp/tmux-1000
  r=$(CI=true $NS npx vitest run $F -t "$t" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E '^\s+Tests ' | tr -s ' ' | sed 's/^ //')
  m=$($NS stat -c '%A' /tmp/tmux-1000 2>&1 | sed 's/.*No such file.*/absent/')
  col='\033[1;31m'; case $m in drwx------|absent) col='\033[1;32m';; esac
  printf '  %-62.62s %-26s /tmp/tmux-1000 → %b%s\033[0m\n' "$t" "$r" "$col" "$m"
done
H "U4  real tmux as uid 1000 after the whole run (the developer's own tmux)"
C "tmux -L mine new-session -d 'sleep 1'"
printf '  %s\n' "$($NS tmux -L mine -f /dev/null new-session -d 'sleep 1' 2>&1; echo "(exit $?)")"
sleep 1.5; rm -rf /tmp/tmux-1000
