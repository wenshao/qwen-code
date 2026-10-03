#!/usr/bin/env bash
# Finding 2, all four creation sites: each fixture alone (dir absent, uid 1000)
# at head vs. with `mkdir -p -m 700` at the four sites.
set -u
WT=/root/verify/pr9273/head/packages/cli
F=src/commands/review/capture-tui.test.ts
NS="unshare --user --map-user=1000 --map-group=1000"
H() { printf '\n\033[1;36m━━ %s\033[0m\n' "$*"; }
C() { printf '\033[2m$ %s\033[0m\n' "$*"; }
cd $WT
restore() { git checkout -q -- $F; }
trap restore EXIT
TESTS=(
  ':800  (TMUX_TMPDIR=/tmp/)|visits a base once even when two candidate strings name it'
  ':971 |a fallback kill that reaped through /tmp does not warn'
  ':1064|a swapped socket at the fallback name keeps the orphan WARNING'
  ':1321|never connects the kill on another base when a stamp proves the bind'
)
arm() {
  for e in "${TESTS[@]}"; do
    site=${e%%|*}; t=${e#*|}
    rm -rf /tmp/tmux-1000
    r=$(CI=true $NS npx vitest run $F -t "$t" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E '^\s+Tests ' | tr -s ' ' | sed 's/^ //')
    m=$($NS stat -c '%A' /tmp/tmux-1000 2>&1)
    col='\033[1;31m'; [ "$m" = drwx------ ] && col='\033[1;32m'
    printf '  %-26s %-34s /tmp/tmux-1000 → %b%s\033[0m\n' "$site" "$r" "$col" "$m"
  done
}
H "HEAD 5936b9f118 — each of the four fixtures run ALONE, /tmp/tmux-1000 absent, uid 1000"
arm
H "Fix: mkdir -p -m 700 at the four creation sites"
sed -i '800s|mkdir -p "|mkdir -p -m 700 "|; 971s|mkdir -p "|mkdir -p -m 700 "|; 1064s|mkdir -p "|mkdir -p -m 700 "|; 1321s|mkdir -p /tmp|mkdir -p -m 700 /tmp|' $F
git diff -U0 | grep '^[-+] ' | sed 's/^/  /'
arm
rm -rf /tmp/tmux-1000
C "vitest run capture-tui.test.ts cleanup.test.ts lib/tui-capture.test.ts   # fixed, dir absent, uid 1000"
CI=true $NS npx vitest run $F src/commands/review/cleanup.test.ts src/commands/review/lib/tui-capture.test.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E '^\s+Tests ' | tr -s ' ' | sed 's/^ /  /;s/^/\x1b[1;32m/;s/$/\x1b[0m/'
restore; trap - EXIT
sleep 1; rm -rf /tmp/tmux-1000
printf '  reverted; worktree clean: %s\n' "$([ -z "$(git status --porcelain)" ] && echo yes || echo NO)"
