#!/usr/bin/env bash
# Finding 2: the "visits a base once" fixture points TMUX_TMPDIR at the real
# /tmp/ and its fake tmux runs `mkdir -p "${TMUX_TMPDIR}/tmux-$(id -u)"` —
# on a host where that dir does not exist yet it creates the REAL socket dir
# with 0755, which real tmux then refuses.
# Non-root is emulated with a user namespace (uid 0 → 1000, no caps), which is
# also what un-skips the three root-gated tests.
set -u
WT=/root/verify/pr9273/head/packages/cli
L=/root/verify/pr9273/logs
NS="unshare --user --map-user=1000 --map-group=1000"
H() { printf '\n\033[1;36m━━ %s\033[0m\n' "$*"; }
C() { printf '\033[2m$ %s\033[0m\n' "$*"; }
cd $WT
rm -rf /tmp/tmux-1000

H "1. Host with no /tmp/tmux-<uid> yet (fresh container / CI box / no tmux since boot), non-root"
C "ls -ld /tmp/tmux-1000"; ls -ld /tmp/tmux-1000 2>&1 | sed 's/^/  /'
C "vitest run capture-tui.test.ts -t 'visits a base once even when two candidate strings name it'"
CI=true $NS npx vitest run src/commands/review/capture-tui.test.ts -t 'visits a base once even when two candidate strings name it' 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Tests ' | sed 's/^ */  /'
C "stat -c '%A' /tmp/tmux-1000"
printf '  \033[1;31m%s\033[0m   ← created by the fixture'"'"'s fake tmux (mkdir -p, umask 022)\n' "$($NS stat -c '%A uid=%u' /tmp/tmux-1000)"
C "tmux -L mine new-session -d    # the developer's own tmux, afterwards"
printf '  \033[1;31m%s\033[0m\n' "$($NS tmux -L mine -f /dev/null new-session -d 'sleep 1' 2>&1; echo "(exit $?)")"

H "2. Same file in full, dir absent at start → the cascade"
rm -rf /tmp/tmux-1000
C "vitest run capture-tui.test.ts cleanup.test.ts lib/tui-capture.test.ts   # as uid 1000"
CI=true $NS npx vitest run src/commands/review/capture-tui.test.ts src/commands/review/cleanup.test.ts src/commands/review/lib/tui-capture.test.ts > $L/f2-absent.log 2>&1
sed 's/\x1b\[[0-9;]*m//g' $L/f2-absent.log | grep -E '^\s+Tests ' | sed 's/^ */  /;s/^/\x1b[1;31m/;s/$/\x1b[0m/'
printf '  dominant reason: %s\n' "$(sed 's/\x1b\[[0-9;]*m//g' $L/f2-absent.log | grep -oE 'tmux failed mid-capture: directory /tmp/tmux-1000 has unsafe permissions' | head -1) (x$(grep -c 'has unsafe permissions' $L/f2-absent.log))"

H "3. Control: same run, but /tmp/tmux-1000 pre-created 0700 by real tmux"
rm -rf /tmp/tmux-1000
$NS tmux -L mk -f /dev/null new-session -d 'sleep 1' >/dev/null 2>&1
C "stat -c '%A' /tmp/tmux-1000 && vitest run …   # identical file list, uid 1000"
printf '  %s\n' "$($NS stat -c '%A' /tmp/tmux-1000)"
CI=true $NS npx vitest run src/commands/review/capture-tui.test.ts src/commands/review/cleanup.test.ts src/commands/review/lib/tui-capture.test.ts > $L/f2-prepared.log 2>&1
sed 's/\x1b\[[0-9;]*m//g' $L/f2-prepared.log | grep -E '^\s+Tests ' | sed 's/^ */  /;s/^/\x1b[1;32m/;s/$/\x1b[0m/'
printf '  (the 1 skip is the padding-tmux-only test; the three uid-0-gated refusal tests ran and passed)\n'
sleep 1.5; rm -rf /tmp/tmux-1000
