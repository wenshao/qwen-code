#!/usr/bin/env bash
# PR #9273 round 2 — delta checks between the R1 head (5936b9f118) and the
# current head (0b51eef6c6), both built from the same worktree into dist-old/
# and dist-new/. Real tmux 3.5a, real freeze v0.2.2 throughout.
set -u
WT=/root/verify/pr9273/head
R=/root/verify/pr9273/e2e/r2
D=$R/delta; [ -z "${ONLY:-}" ] && rm -rf $D; mkdir -p $D
FREEZE_DIR=/root/verify/pr9273/tools/bin
BASE_PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH=$BASE_PATH
NODE=$(command -v node)
SOCKDIR=/tmp/tmux-$(id -u)
H() { printf '\n\033[1;36m━━ %s\033[0m\n' "$*"; }
C() { printf '\033[2m$ %s\033[0m\n' "$*"; }
OK() { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
BAD() { printf '\033[1;31m✘ %s\033[0m\n' "$*"; FAILS=$((FAILS+1)); }
NOTE() { printf '\033[33m  %s\033[0m\n' "$*"; }
FAILS=0
want() { [ -z "${ONLY:-}" ] || [[ " $ONLY " == *" $1 "* ]]; }
check() { if eval "$1"; then OK "$2"; else BAD "$2"; fi; }
captures() { ls "$SOCKDIR" 2>/dev/null | grep -c '^qwen-review-capture-'; }
cli() { local arm=$1; shift; "$NODE" "$WT/dist-$arm/cli.js" "$@"; }
label() { [ "$1" = old ] && echo "5936b9f118 (R1 head)" || echo "0b51eef6c6 (current head)"; }

printf '\033[1mPR #9273 round 2 — delta checks\033[0m  tmux=%s  freeze=%s  rasterizer=%s\n' \
  "$(tmux -V)" "$($FREEZE_DIR/freeze --version | awk '{print $3}')" "$(command -v rsvg-convert || echo built-in)"
B0=$(captures)

# ── D1: the png rung on a real TUI (qwen itself), both heads ──────────────
H "D1  png rung: capture the real qwen TUI at 80x24 with real freeze on PATH"
QCMD="$NODE $WT/dist-new/cli.js --auth-type openai --openai-api-key dummy --openai-base-url http://127.0.0.1:9 --model dummy-model"
for arm in old new; do
  mkdir -p $D/d1-$arm
  C "[$(label $arm)] HOME=qhome capture-tui --command '<qwen TUI>' --until 'Type your message' --cols 80 --rows 24 --out d1-$arm/qwen"
  (cd /root/verify/pr9273/e2e/qproj && HOME=/root/verify/pr9273/e2e/qhome PATH="$FREEZE_DIR:$BASE_PATH" \
    cli $arm review capture-tui --command "$QCMD" --until 'Type your message' --cols 80 --rows 24 \
    --timeout-ms 60000 --out $D/d1-$arm/qwen >$D/d1-$arm/stdout 2>$D/d1-$arm/stderr); echo $? > $D/d1-$arm/rc
  printf '  exit=%s  manifest=%s\n' "$(cat $D/d1-$arm/rc)" "$(jq -c '{evidence,settledBy}' $D/d1-$arm/qwen.json)"
  printf '  file qwen.png → %s\n' "$(file -b $D/d1-$arm/qwen.png | cut -c1-48)"
  printf '  leftovers: %s\n' "$(ls $D/d1-$arm | grep -c 'render-' ) staged file(s)"
done
# The repo's own publish gate, called on the files that actually landed.
mkdir -p $WT/packages/cli/src/__probe9273r2__
cat > $WT/packages/cli/src/__probe9273r2__/gate.test.ts <<EOF
import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { validateAssetContent } from '../commands/review/lib/assets.js';
it('gate', () => {
  const out: Record<string, unknown> = {};
  for (const arm of ['old', 'new']) {
    const head = readFileSync('$D/d1-' + arm + '/qwen.png').subarray(0, 64);
    out[arm] = validateAssetContent('qwen.png', head);
  }
  writeFileSync('$D/gate.json', JSON.stringify(out));
});
EOF
(cd $WT/packages/cli && CI=true npx vitest run src/__probe9273r2__/gate.test.ts >$D/gate.log 2>&1)
rm -rf $WT/packages/cli/src/__probe9273r2__
C "validateAssetContent('qwen.png', <landed bytes>)   # review/lib/assets.ts, the publish-assets gate"
printf '  old: %s\n  new: %s\n' "$(jq -c .old $D/gate.json)" "$(jq -c .new $D/gate.json)"
check "file $D/d1-old/qwen.png | grep -q SVG" "R1 head reproduces: qwen.png is SVG text"
check "[ \$(cat $D/d1-new/rc) = 0 ] && [ \"\$(jq -r .evidence $D/d1-new/qwen.json)\" = png ] && file $D/d1-new/qwen.png | grep -q 'PNG image'" "current head: evidence=png and qwen.png is a real PNG"
check "jq -e '.new.ok == true and .old.ok == false' $D/gate.json >/dev/null" "publish gate: accepts the current head's file, refuses R1's"
check "[ \$(ls $D/d1-new | grep -c render-) = 0 ]" "no .render-<nonce> staging files left next to the output"

# ── D2: the png rung when freeze itself crashes (no rsvg-convert on PATH) ─
H "D2  png rung when freeze crashes: host without rsvg-convert → freeze's built-in rasterizer segfaults"
NB=$D/d2-bin; mkdir -p $NB
for b in tmux sleep; do ln -s "$(command -v $b)" $NB/$b; done; ln -s $FREEZE_DIR/freeze $NB/freeze
C "PATH=<tmux, sleep, freeze only> capture-tui --command 'printf \"crash test DONE\\n\"; sleep 30' --until DONE --out d2/cap"
mkdir -p $D/d2
PATH=$NB cli new review capture-tui --command 'printf "crash test DONE\n"; sleep 30' --until DONE --cols 40 --rows 6 \
  --out $D/d2/cap >$D/d2/stdout 2>$D/d2/stderr; rc=$?
printf '  exit=%s  manifest=%s\n' "$rc" "$(jq -c '{evidence,pngPath}' $D/d2/cap.json)"
printf '  degradedBecause (freeze clause): %s\n' "$(jq -r .degradedBecause $D/d2/cap.json | tr '\t' ' ' | grep -oE 'freeze failed \(exit.*' | tr -s ' ' | cut -c1-200)"
printf '  files: %s\n' "$(ls $D/d2 | tr '\n' ' ')"
check "[ $rc = 0 ] && [ \"\$(jq -r .evidence $D/d2/cap.json)\" = ans-only ]" "freeze crash degrades to evidence=ans-only (no png certified)"
check "jq -r .degradedBecause $D/d2/cap.json | grep -qi freeze" "degradedBecause names the freeze failure"
check "[ ! -e $D/d2/cap.png ] && [ \$(ls $D/d2 | grep -c render-) = 0 ]" "no cap.png and no staging litter after the crash"

# ── D3: exact-match session target (R26-4) ──────────────────────────────
H "D3  decoy session planted on the run's own private server (R26-4)"
DECOY='srv=$(basename "${TMUX%%,*}"); tmux -L "$srv" new-session -d -s capdecoy '"'"'printf "DECOY-FROM-INSIDE foreign-bytes\n"; sleep 40'"'"'; tmux -L "$srv" kill-session -t =cap; sleep 40'
C "capture-tui --command '<plant capdecoy on \$TMUX's server; kill-session -t =cap>' --until DECOY-FROM-INSIDE --out d3-<arm>/cap"
for arm in old new; do
  mkdir -p $D/d3-$arm
  cli $arm review capture-tui --command "$DECOY" --until DECOY-FROM-INSIDE --timeout-ms 8000 --cols 60 --rows 6 \
    --out $D/d3-$arm/cap >$D/d3-$arm/stdout 2>$D/d3-$arm/stderr; echo $? > $D/d3-$arm/rc
  printf '  [%s] exit=%s  .ans=%s\n' "$(label $arm)" "$(cat $D/d3-$arm/rc)" \
    "$( [ -f $D/d3-$arm/cap.ans ] && grep -a -m1 . $D/d3-$arm/cap.ans | sed 's/\x1b\[[0-9;]*m//g' || echo '(none)')"
  [ -f $D/d3-$arm/cap.json ] && printf '        manifest=%s\n' "$(jq -c '{evidence,settledBy}' $D/d3-$arm/cap.json)"
  printf '        stderr=%s\n' "$(head -1 $D/d3-$arm/stderr | sed 's/ — tmux 3.5a trims.*//' | cut -c1-150)"
done
check "[ \$(cat $D/d3-old/rc) = 0 ] && grep -q DECOY-FROM-INSIDE $D/d3-old/cap.ans" "R1 head reproduces: decoy pane bytes certified as this run's evidence (exit 0)"
check "[ \$(cat $D/d3-new/rc) = 3 ] && [ ! -e $D/d3-new/cap.ans ] && [ ! -e $D/d3-new/cap.json ] && grep -q 'mid-capture' $D/d3-new/stderr" "current head: refuses mid-capture (exit 3), no .ans, no manifest"
sleep 0.5
check "[ \$(captures) = $B0 ]" "no capture server/socket left behind"
# honest path unchanged: same session name, nothing planted
cli new review capture-tui --command 'printf "plain cap session OK\n"; sleep 30' --until OK --out $D/d3-plain >/dev/null 2>&1
check "[ \$? = 0 ] && grep -q 'plain cap session OK' $D/d3-plain.ans" "control: an ordinary capture still works with the =cap: target"

# ── D4: a signal-killed probe asserts nothing about usability (R26-2) ───
H "D4  a probe killed by a signal (R26-2)"
SB=$D/d4-bin; mkdir -p $SB/t $SB/f
printf '#!/bin/sh\n[ "$1" = "-V" ] && kill -TERM $$\nexec /usr/bin/tmux "$@"\n' > $SB/t/tmux
printf '#!/bin/sh\n[ "$1" = "--help" ] && kill -TERM $$\nexec %s "$@"\n' "$FREEZE_DIR/freeze" > $SB/f/freeze
chmod +x $SB/t/tmux $SB/f/freeze
C "PATH=<tmux whose -V dies by SIGTERM> capture-tui …"
for arm in old new; do
  mkdir -p $D/d4-$arm
  PATH="$SB/t:$BASE_PATH" cli $arm review capture-tui --command 'printf hi; sleep 5' --out $D/d4-$arm/t >$D/d4-$arm/t.stdout 2>$D/d4-$arm/t.stderr; echo $? > $D/d4-$arm/t.rc
  printf '  [%s] exit=%s  %s\n' "$(label $arm)" "$(cat $D/d4-$arm/t.rc)" "$(tr '\n' ' ' < $D/d4-$arm/t.stderr | cut -c1-230)"
done
C "PATH=<freeze whose --help dies by SIGTERM>:\$PATH capture-tui …   # degrade consumer"
for arm in old new; do
  PATH="$SB/f:$BASE_PATH" cli $arm review capture-tui --command 'printf "deg DONE\n"; sleep 30' --until DONE --out $D/d4-$arm/f >/dev/null 2>$D/d4-$arm/f.stderr; echo $? > $D/d4-$arm/f.rc
  printf '  [%s] exit=%s  evidence=%s  degradedBecause (freeze clause)=%s\n' "$(label $arm)" "$(cat $D/d4-$arm/f.rc)" "$(jq -r .evidence $D/d4-$arm/f.json)" "$(jq -r .degradedBecause $D/d4-$arm/f.json | grep -oE 'freeze could not be probed.*' | cut -c1-190)"
done
check "grep -q 'installed but not' $D/d4-old/t.stderr && grep -q 'installed but not' $D/d4-old/f.json" "R1 head reproduces: a signal death is reported as 'installed but not usable here'"
check "grep -q 'killed by a' $D/d4-new/t.stderr && ! grep -q 'installed but not' $D/d4-new/t.stderr && [ \$(cat $D/d4-new/t.rc) = 3 ]" "current head, tmux probe: exit 3, 'killed by a signal', no installation claim"
check "jq -r .degradedBecause $D/d4-new/f.json | grep -q 'killed' && ! grep -q 'installed but not' $D/d4-new/f.json && [ \"\$(jq -r .evidence $D/d4-new/f.json)\" = ans-only ]" "current head, freeze probe: ans-only, 'killed by a signal', no installation claim"
# The realistic shape: coreutils timeout signals the whole group while the probe runs.
printf '#!/bin/sh\n[ "$1" = "-V" ] && exec sleep 10\nexec /usr/bin/tmux "$@"\n' > $SB/t/tmux-slow; chmod +x $SB/t/tmux-slow
mkdir -p $SB/slow; ln -sf $SB/t/tmux-slow $SB/slow/tmux
C "timeout -s TERM 2 capture-tui …   # tmux -V hangs; timeout signals the whole process group"
for arm in old new; do
  PATH="$SB/slow:$BASE_PATH" /usr/bin/timeout -s TERM 2 "$NODE" "$WT/dist-$arm/cli.js" review capture-tui --command 'printf hi' --out $D/d4-$arm/g >$D/d4-$arm/g.stdout 2>$D/d4-$arm/g.stderr; echo $? > $D/d4-$arm/g.rc
  printf '  [%s] exit=%s  stderr=%s\n' "$(label $arm)" "$(cat $D/d4-$arm/g.rc)" "$(tr '\n' ' ' < $D/d4-$arm/g.stderr | cut -c1-200)"
done

# ── D5: cleanup when the socket is already gone after the kill (R26-3) ──
H "D5  review cleanup when tmux unlinks the socket itself on kill-server (R26-3)"
WB=$D/d5-bin; mkdir -p $WB
cat > $WB/tmux <<'EOF'
#!/bin/sh
# real tmux, plus what tmux builds that unlink on exit do: remove the socket
/usr/bin/tmux "$@"; rc=$?
name=; prev=
for a in "$@"; do [ "$prev" = "-L" ] && name=$a; prev=$a; done
case " $* " in *" kill-server"*) [ -n "$name" ] && rm -f "${TMUX_TMPDIR:-/tmp}/tmux-$(id -u)/$name";; esac
exit $rc
EOF
chmod +x $WB/tmux
C "tmux -L x kill-server on this host leaves the socket (tmux 3.5a): $(tmux -L d5probe -f /dev/null new-session -d 'sleep 30'; tmux -L d5probe kill-server; stat -c %F $SOCKDIR/d5probe; rm -f $SOCKDIR/d5probe)"
mkdir -p $D/d5-repo; git -C $D/d5-repo init -q
for arm in old new; do
  # the node process itself, not a subshell: $! must be the launcher's pid
  "$NODE" "$WT/dist-new/cli.js" review capture-tui --command 'printf "doomed\n"; exec sleep 7071' --until NEVER --timeout-ms 60000 --out $D/d5-$arm-kill9 >/dev/null 2>&1 &
  p=$!
  for i in $(seq 1 80); do [ "$(captures)" -gt "$B0" ] && break; sleep 0.1; done; sleep 0.5
  ORPHAN=$(ls $SOCKDIR | grep "^qwen-review-capture-$p-")
  [ -n "$ORPHAN" ] || { BAD "no orphan socket for launcher $p"; continue; }
  kill -9 $p; wait $p 2>/dev/null; sleep 0.3
  C "[$(label $arm)] (cd repo && PATH=<unlinking tmux>:\$PATH qwen review cleanup pr-999999)   # orphan $ORPHAN"
  (cd $D/d5-repo && PATH="$WB:$BASE_PATH" cli $arm review cleanup pr-999999 >$D/d5-$arm.stdout 2>$D/d5-$arm.stderr)
  sed 's/^/  stdout: /' $D/d5-$arm.stdout; grep -v 'bypass audit' $D/d5-$arm.stderr | cut -c1-260 | sed 's/^/  stderr: /'
  printf '  socket after: %s   server alive: %s\n' "$(stat -c %F $SOCKDIR/$ORPHAN 2>/dev/null || echo gone)" "$(/usr/bin/tmux -L $ORPHAN has-session 2>/dev/null && echo yes || echo no)"
  ps -eo pid,comm,args | awk '$2=="sleep" && $4=="7071" {print $1}' | xargs -r kill
done
check "grep -q 'WARNING' $D/d5-old.stderr && ! grep -q '^Reaped' $D/d5-old.stdout" "R1 head reproduces: WARNING about a socket 'left in place' over a path that is gone, no Reaped line"
check "grep -q '^Reaped orphaned capture server' $D/d5-new.stdout && ! grep -q WARNING $D/d5-new.stderr && grep -q 'Nothing to clean' $D/d5-new.stdout" "current head: Reaped + Nothing to clean, no WARNING"
check "[ \$(captures) = $B0 ]" "no capture server/socket left behind"

H "Summary"
if [ $FAILS = 0 ]; then OK "all delta checks passed"; else BAD "$FAILS delta check(s) failed"; fi
