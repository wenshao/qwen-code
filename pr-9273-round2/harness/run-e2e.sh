#!/usr/bin/env bash
# PR #9273 end-to-end verification: real tmux 3.5a, real freeze v0.2.2, the
# built dist/cli.js from the PR head. Every scenario prints a coloured
# transcript so the run itself can be rendered as evidence.
set -u
WT=/root/verify/pr9273/head
DIST=${DIST:-dist-new}
CLI="node $WT/$DIST/cli.js"
OUT=${OUT:-/root/verify/pr9273/e2e/r2/out}
FREEZE_DIR=/root/verify/pr9273/tools/bin
BASE_PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH="$BASE_PATH"
NODE=$(command -v node)
rm -rf "$OUT"; mkdir -p "$OUT"
SOCKDIR=/tmp/tmux-$(id -u)

H() { printf '\n\033[1;36m━━ %s\033[0m\n' "$*"; }
C() { printf '\033[2m$ %s\033[0m\n' "$*"; }
OK() { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
BAD() { printf '\033[1;31m✘ %s\033[0m\n' "$*"; FAILS=$((FAILS+1)); }
FAILS=0
captures() { ls "$SOCKDIR" 2>/dev/null | grep -c '^qwen-review-capture-' ; }
capproc() { ps -eo pid,args | grep -E '[t]mux .*-L qwen-review-capture-' | wc -l; }
check() { if eval "$1"; then OK "$2"; else BAD "$2"; fi; }

printf '\033[1mPR #9273 capture-tui E2E\033[0m  head=%s  tmux=%s  freeze=%s\n' \
  "$(git -C $WT rev-parse --short=10 HEAD)" "$(tmux -V)" "$($FREEZE_DIR/freeze --version | awk '{print $3}')"
BEFORE_SOCK=$(captures)

# ── S1: the PR's own example, freeze NOT on PATH → ans-only ───────────────
H "S1  README example, freeze absent → evidence=ans-only"
mkdir -p "$OUT/s1"
C "qwen review capture-tui --command 'printf \"HELLO-\\033[31mRED\\033[0m-WORLD\\n\"; sleep 30' --until WORLD --out s1/cap"
t0=$(date +%s%N)
$CLI review capture-tui --command 'printf "HELLO-\033[31mRED\033[0m-WORLD\n"; sleep 30' \
  --until WORLD --out "$OUT/s1/cap" >"$OUT/s1/stdout" 2>"$OUT/s1/stderr"; rc=$?
ms=$(( ($(date +%s%N)-t0)/1000000 ))
echo "exit=$rc  wall=${ms}ms  stdout=$(cat $OUT/s1/stdout)"
jq -c '{evidence,settledBy,pngPath,degradedBecause}' "$OUT/s1/cap.json"
printf 'ans bytes: '; head -c 40 "$OUT/s1/cap.ans" | od -An -c | tr -s ' ' | head -2
check "[ $rc = 0 ]" "exit 0"
check "[ $ms -lt 15000 ]" "settled on --until, not on the 30s sleep (${ms}ms)"
check "grep -q \$'\\x1b\\[31mRED' $OUT/s1/cap.ans" ".ans carries the SGR bytes (ESC[31mRED)"
check "[ \"\$(jq -r .evidence $OUT/s1/cap.json)\" = ans-only ]" "manifest evidence=ans-only"
check "jq -r .degradedBecause $OUT/s1/cap.json | grep -qi freeze" "degradedBecause names freeze"
check "[ \$(captures) = $BEFORE_SOCK ] && [ \$(capproc) = 0 ]" "no capture server/socket left behind"

# ── S2: same, freeze on PATH → png ────────────────────────────────────────
H "S2  freeze v0.2.2 on PATH → evidence=png"
mkdir -p "$OUT/s2"
CMD2='printf "\033[1;37;44m capture-tui \033[0m \033[32mgreen\033[0m \033[33myellow\033[0m \033[35mmagenta\033[0m\n"; printf "\033[1mbold\033[0m \033[4munderline\033[0m \033[7mreverse\033[0m\n"; printf "%s\n" "┌────────────┐" "│ box-drawing │" "└────────────┘" "中文宽字符 ✓ DONE"; sleep 30'
C "PATH=\$FREEZE:\$PATH qwen review capture-tui --command '<SGR + box + CJK>' --until DONE --cols 60 --rows 8 --out s2/cap"
PATH="$FREEZE_DIR:$BASE_PATH" $CLI review capture-tui --command "$CMD2" --until DONE \
  --cols 60 --rows 8 --out "$OUT/s2/cap" >"$OUT/s2/stdout" 2>"$OUT/s2/stderr"; rc=$?
echo "exit=$rc  stdout=$(cat $OUT/s2/stdout)"
jq -c '{evidence,settledBy,pngPath,degradedBecause,cols,rows}' "$OUT/s2/cap.json"
file "$OUT/s2/cap.png" | sed "s|$OUT/||"
check "[ $rc = 0 ]" "exit 0"
check "[ \"\$(jq -r .evidence $OUT/s2/cap.json)\" = png ]" "manifest evidence=png"
check "file $OUT/s2/cap.png | grep -q 'PNG image'" "cap.png is a real PNG (file magic)"
check "[ \$(captures) = $BEFORE_SOCK ] && [ \$(capproc) = 0 ]" "no capture server/socket left behind"

# ── S3: isolation — run FROM INSIDE the user's own tmux session ───────────
H "S3  isolation: launched inside the user's own tmux session"
mkdir -p "$OUT/s3"
U="tmux -L pr9273-user"
$U kill-server 2>/dev/null
$U -f /dev/null new-session -d -s mywork -x 100 -y 30 "printf 'USER-PRIVATE-PANE token=hunter2\n'; exec sleep 600"
sleep 0.5
$U list-sessions -F '#{session_name} #{session_windows}w #{window_width}x#{window_height}' > "$OUT/s3/user-before"
$U capture-pane -p -t mywork:0 > "$OUT/s3/user-pane-before"
echo "user server before: $(cat $OUT/s3/user-before)"
C "tmux -L pr9273-user new-window -t mywork '<capture-tui --cols 40 --rows 6 …>'   # TMUX is set inside"
$U new-window -t mywork -d "env | grep -q '^TMUX=' && echo TMUX-SET > $OUT/s3/tmux-env; PATH=$FREEZE_DIR:$BASE_PATH $NODE $WT/$DIST/cli.js review capture-tui --command 'printf \"inside-capture %s\\n\" CAPTURED; sleep 30' --until CAPTURED --cols 40 --rows 6 --out $OUT/s3/cap > $OUT/s3/stdout 2> $OUT/s3/stderr; echo \$? > $OUT/s3/rc"
for i in $(seq 1 100); do [ -s "$OUT/s3/rc" ] && break; sleep 0.2; done
rc=$(cat "$OUT/s3/rc" 2>/dev/null || echo none)
sleep 0.3
$U list-sessions -F '#{session_name} #{session_windows}w #{window_width}x#{window_height}' > "$OUT/s3/user-after"
$U capture-pane -p -t mywork:0 > "$OUT/s3/user-pane-after"
echo "capture exit=$rc ($(cat $OUT/s3/tmux-env 2>/dev/null)); user server after: $(cat $OUT/s3/user-after)"
check "[ \"$rc\" = 0 ]" "capture inside the user's tmux exits 0"
check "[ -f $OUT/s3/tmux-env ]" "TMUX was set in the launching shell (a real nested launch)"
check "[ \"\$(head -c 12 $OUT/s3/user-before)\" = \"\$(head -c 12 $OUT/s3/user-after)\" ] && grep -q '100x30' $OUT/s3/user-after" "user session still alive, geometry still 100x30 (not resized to 40x6)"
check "cmp -s $OUT/s3/user-pane-before $OUT/s3/user-pane-after" "user pane content byte-identical"
check "grep -q 'inside-capture CAPTURED' $OUT/s3/cap.ans && ! grep -q hunter2 $OUT/s3/cap.ans" "capture holds only its own pane — no user-pane bytes"
check "[ \$(captures) = $BEFORE_SOCK ] && [ \$(capproc) = 0 ]" "no capture server/socket left behind"

# ── S4: refusal contract ─────────────────────────────────────────────────
H "S4  refusal contract (exit 3, reason on stderr, JSON on stdout, no manifest)"
mkdir -p "$OUT/s4"
refusal() { # name, then args
  local n=$1; shift
  "$@" >"$OUT/s4/$n.stdout" 2>"$OUT/s4/$n.stderr"; local r=$?
  printf '  %-14s exit=%s  stdout=%s\n' "$n" "$r" "$(head -c 150 $OUT/s4/$n.stdout)"
  printf '  %-14s stderr=%s\n' "" "$(head -c 160 $OUT/s4/$n.stderr | tr '\n' ' ')"
  echo "$r" > "$OUT/s4/$n.rc"
}
refusal empty-out $CLI review capture-tui --command 'printf hi' --out ''
refusal no-tmux env PATH=/nonexistent "$NODE" $WT/$DIST/cli.js review capture-tui --command 'printf hi' --out "$OUT/s4/notmux"
refusal bad-regex $CLI review capture-tui --command 'printf hi' --until '(' --out "$OUT/s4/badre"
refusal bad-cols $CLI review capture-tui --command 'printf hi' --cols 0 --out "$OUT/s4/badcols"
printf 'PRECIOUS user file — must survive\n' > "$OUT/s4/foreign.ans"; sha_before=$(sha256sum < "$OUT/s4/foreign.ans")
refusal foreign-ans $CLI review capture-tui --command 'printf hi; sleep 5' --settle-ms 300 --out "$OUT/s4/foreign"
for n in empty-out no-tmux bad-regex bad-cols foreign-ans; do
  check "[ \$(cat $OUT/s4/$n.rc) = 3 ] && jq -e '.captured==false and .evidence==\"none\" and (.reason|length>0)' $OUT/s4/$n.stdout >/dev/null && [ -s $OUT/s4/$n.stderr ]" "$n: exit 3 + stderr reason + {captured:false,evidence:none} JSON"
done
check "[ ! -e $OUT/s4/notmux.json ] && [ ! -e $OUT/s4/badre.json ] && [ ! -e $OUT/s4/foreign.json ]" "no manifest written by any refusal"
check "[ \"\$(sha256sum < $OUT/s4/foreign.ans)\" = \"$sha_before\" ]" "foreign <out>.ans left byte-identical"
check "[ \$(captures) = $BEFORE_SOCK ] && [ \$(capproc) = 0 ]" "no capture server/socket left behind"

# ── S5: re-used --out (own previous run) ────────────────────────────────
H "S5  re-used --out: a previous run of this command is replaced"
C "capture-tui … --out s1/cap   (second time, different output)"
$CLI review capture-tui --command 'printf "SECOND-RUN\n"; sleep 30' --until SECOND --out "$OUT/s1/cap" >"$OUT/s1/stdout2" 2>"$OUT/s1/stderr2"; rc=$?
echo "exit=$rc  $(head -c 60 $OUT/s1/cap.ans | tr -d '\n')"
check "[ $rc = 0 ] && grep -q SECOND-RUN $OUT/s1/cap.ans && ! grep -q HELLO $OUT/s1/cap.ans" "own artifacts replaced, exit 0"

# ── S6: --until timeout and --ready/--keys ──────────────────────────────
H "S6  --until timeout is recorded; --ready gates --keys"
mkdir -p "$OUT/s6"
$CLI review capture-tui --command 'printf "never-the-marker\n"; sleep 30' --until NEVER-APPEARS --timeout-ms 2500 --out "$OUT/s6/to" >/dev/null 2>"$OUT/s6/to.stderr"; rc=$?
echo "timeout run: exit=$rc  $(jq -c '{settledBy,evidence,degradedBecause}' $OUT/s6/to.json)"
check "[ $rc = 0 ] && [ \"\$(jq -r .settledBy $OUT/s6/to.json)\" = timeout ]" "never-matching --until: captured anyway, settledBy=timeout"
READ_CMD='printf "NAME? "; read n; printf "\033[1;32mHI-%s\033[0m\n" "$n"; sleep 30'
$CLI review capture-tui --command "$READ_CMD" --ready 'NAME\?' --keys alice Enter --until 'HI-alice' --out "$OUT/s6/keys" >/dev/null 2>"$OUT/s6/keys.stderr"; rc=$?
echo "keys run:    exit=$rc  $(jq -c '{keys,keysSent,settledBy}' $OUT/s6/keys.json)  pane: $(grep -a HI- $OUT/s6/keys.ans | cat -v)"
check "[ $rc = 0 ] && [ \"\$(jq -r .keysSent $OUT/s6/keys.json)\" = true ] && grep -q HI-alice $OUT/s6/keys.ans" "keys typed after --ready matched; reply rendered"
$CLI review capture-tui --command "$READ_CMD" --ready 'NO-SUCH-PROMPT' --keys alice Enter --timeout-ms 2500 --out "$OUT/s6/withheld" >/dev/null 2>"$OUT/s6/withheld.stderr"; rc=$?
echo "withheld:    exit=$rc  $(jq -c '{keysSent,settledBy,degradedBecause}' $OUT/s6/withheld.json)"
check "[ \"\$(jq -r .keysSent $OUT/s6/withheld.json)\" = false ] && ! grep -q HI-alice $OUT/s6/withheld.ans" "--ready never matched: keys withheld, manifest says so"
check "[ \$(captures) = $BEFORE_SOCK ] && [ \$(capproc) = 0 ]" "no capture server/socket left behind"

# ── S7: signals reap; SIGKILL orphans → cleanup sweep reaps ─────────────
H "S7  SIGTERM mid-run reaps; SIGKILL leaves an orphan that 'review cleanup' reaps"
mkdir -p "$OUT/s7" "$OUT/s7/repo"; git -C "$OUT/s7/repo" init -q
for sig in TERM INT; do
  $CLI review capture-tui --command 'printf "waiting\n"; sleep 60' --until NEVER --timeout-ms 60000 --out "$OUT/s7/$sig" >"$OUT/s7/$sig.stdout" 2>"$OUT/s7/$sig.stderr" &
  p=$!
  for i in $(seq 1 50); do [ "$(captures)" -gt "$BEFORE_SOCK" ] && break; sleep 0.1; done
  sleep 0.5; kill -$sig $p; wait $p; rc=$?
  sleep 0.3
  echo "SIG$sig: exit=$rc  sockets-left=$(( $(captures)-BEFORE_SOCK ))  servers-left=$(capproc)  stdout=$(head -c 120 $OUT/s7/$sig.stdout)"
  check "[ \$(captures) = $BEFORE_SOCK ] && [ \$(capproc) = 0 ] && [ ! -e $OUT/s7/$sig.json ]" "SIG$sig: server reaped by the signal net, no manifest"
done
# a live capture that the sweep must NOT touch
$CLI review capture-tui --command 'printf "live-capture\n"; sleep 60' --until NEVER --timeout-ms 20000 --out "$OUT/s7/live" >/dev/null 2>&1 &
LIVE=$!
$CLI review capture-tui --command 'printf "doomed\n"; exec sleep 6061' --until NEVER --timeout-ms 60000 --out "$OUT/s7/kill9" >/dev/null 2>&1 &
p=$!
for i in $(seq 1 80); do [ "$(captures)" -ge $((BEFORE_SOCK+2)) ] && break; sleep 0.1; done
sleep 0.5
ORPHAN=$(ls "$SOCKDIR" | grep "^qwen-review-capture-$p-")
kill -9 $p; wait $p 2>/dev/null
sleep 0.5
echo "after SIGKILL of $p: orphan socket=$ORPHAN  server alive=$(tmux -L "$ORPHAN" list-sessions -F '#{session_name}' 2>&1)"
check "[ -n \"$ORPHAN\" ] && tmux -L $ORPHAN has-session 2>/dev/null" "SIGKILL leaves a live orphan server (the case the sweep exists for)"
C "(cd scratch-repo && qwen review cleanup pr-999999)"
(cd "$OUT/s7/repo" && $CLI review cleanup pr-999999 >"$OUT/s7/cleanup.stdout" 2>"$OUT/s7/cleanup.stderr"; echo $? > "$OUT/s7/cleanup.rc")
echo "cleanup exit=$(cat $OUT/s7/cleanup.rc)  stdout: $(cat $OUT/s7/cleanup.stdout | tr '\n' ' ')"
[ -s "$OUT/s7/cleanup.stderr" ] && echo "cleanup stderr: $(cat $OUT/s7/cleanup.stderr | tr '\n' ' ')"
check "! tmux -L $ORPHAN has-session 2>/dev/null && [ ! -e $SOCKDIR/$ORPHAN ]" "orphan server killed and socket gone"
printf '\033[33mnote: ready sentinel(s) left in $TMPDIR by the SIGKILLed launcher: %s\033[0m\n' "$(ls /tmp/qwen-capture-ready-$p-* 2>/dev/null | wc -l)"
check "kill -0 $LIVE 2>/dev/null && [ -n \"\$(ls $SOCKDIR | grep ^qwen-review-capture-$LIVE-)\" ]" "the LIVE capture (pid alive) was not touched"
check "tmux -L pr9273-user has-session -t mywork 2>/dev/null" "the user's own server was not touched"
check "[ -z \"\$(ps -eo pid,comm,args | awk '\$2==\"sleep\" && \$4==\"6061\"')\" ]" "orphan's pane process (sleep 6061) is gone"
wait $LIVE; echo "live capture finished: exit=$?  $(jq -c '{settledBy,evidence}' $OUT/s7/live.json)"
check "[ \$(captures) = $BEFORE_SOCK ] && [ \$(capproc) = 0 ]" "no capture server/socket left behind"

# ── S8: documented limit — a daemonized grandchild outlives the reap ─────
H "S8  documented non-goal: a setsid'd descendant outlives the reap (header says so)"
$CLI review capture-tui --command 'setsid sleep 4242 </dev/null >/dev/null 2>&1 & printf "spawned DAEMON\n"; sleep 30' --until DAEMON --out "$OUT/s8/cap" >/dev/null 2>&1; rc=$?
mkdir -p "$OUT/s8"
surv=$(ps -eo pid,args | grep '[s]leep 4242' | awk '{print $1}')
echo "exit=$rc  surviving setsid'd pid=${surv:-none}"
check "[ -n \"$surv\" ]" "matches the header: the detached grandchild survives (documented, not a regression)"
[ -n "$surv" ] && kill $surv

$U kill-server 2>/dev/null
H "Summary"
if [ $FAILS = 0 ]; then OK "all checks passed"; else BAD "$FAILS check(s) failed"; fi
