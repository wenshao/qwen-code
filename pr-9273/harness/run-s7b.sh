#!/usr/bin/env bash
set -u
WT=/root/verify/pr9273/head; CLI="node $WT/dist/cli.js"; OUT=/root/verify/pr9273/e2e/out/s7b
rm -rf $OUT; mkdir -p $OUT/repo; git -C $OUT/repo init -q
SOCKDIR=/tmp/tmux-$(id -u)
captures() { ls "$SOCKDIR" 2>/dev/null | grep -c '^qwen-review-capture-' ; }
OK() { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }; BAD() { printf '\033[1;31m✘ %s\033[0m\n' "$*"; }
check() { if eval "$1"; then OK "$2"; else BAD "$2"; fi; }
printf '\n\033[1;36m━━ S7b  SIGKILL orphan → review cleanup (pane process identified uniquely)\033[0m\n'
B=$(captures)
$CLI review capture-tui --command 'printf "doomed\n"; exec sleep 6061' --until NEVER --timeout-ms 60000 --out $OUT/kill9 >/dev/null 2>&1 &
p=$!
for i in $(seq 1 80); do [ "$(captures)" -gt "$B" ] && break; sleep 0.1; done; sleep 0.5
ORPHAN=$(ls $SOCKDIR | grep "^qwen-review-capture-$p-")
kill -9 $p; wait $p 2>/dev/null; sleep 0.5
SRV=$(ps -eo pid,comm,args | awk -v o="$ORPHAN" '$2 ~ /^tmux/ && index($0,o) {print $1}' | head -1)
PANE=$(ps -eo pid,comm,args | awk '$2=="sleep" && $4=="6061" {print $1}')
echo "launcher $p SIGKILLed → orphan socket $ORPHAN, tmux server pid ${SRV:-none}, pane pid ${PANE:-none}"
check "[ -n \"$SRV\" ] && [ -n \"$PANE\" ]" "orphan server + its pane process outlive the launcher"
printf '\033[2m$ (cd scratch-repo && qwen review cleanup pr-999999)\033[0m\n'
(cd $OUT/repo && $CLI review cleanup pr-999999 2>&1); sleep 0.3
check "! kill -0 $SRV 2>/dev/null" "tmux server pid $SRV gone"
check "! kill -0 $PANE 2>/dev/null" "pane process (sleep 6061, pid $PANE) gone"
check "[ ! -e $SOCKDIR/$ORPHAN ]" "socket $ORPHAN removed"
printf '\033[2m$ qwen review cleanup pr-999999   # second run: nothing left to reap\033[0m\n'
(cd $OUT/repo && $CLI review cleanup pr-999999 2>&1)
