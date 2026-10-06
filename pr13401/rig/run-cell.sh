#!/bin/bash
# Usage: run-cell.sh <tag> <worktree> <mutants> <module> <tests|ALL> [argLine]
#   tests=ALL -> full module "clean test" with failure.ignore (both lanes run, as CI configures them)
#   otherwise -> -Dtest=<tests> (pinned lane profile inactive), optional argLine JVM flags
S=$SCRATCH
TAG=$1; WT=$2; MUT=$3; MOD=$4; TESTS=$5; ARGL=$6
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:$PATH
M2=$S/m2/$(basename $WT); [ -d $M2 ] || cp -Rc $S/m2/seed $M2
mkdir -p $S/cells
node $S/mut.mjs $WT $MUT > $S/cells/$TAG.mut 2>&1 || { echo "$TAG APPLY-FAIL"; cat $S/cells/$TAG.mut; exit 1; }
git -C $WT diff > $S/cells/$TAG.diff
LOG=$S/cells/$TAG.log
ARGS=(-B -o -Dmaven.repo.local=$M2 -Dgpg.skip -Dcheckstyle.skip -Dspotbugs.skip)
if [ "$TESTS" = ALL ]; then ARGS+=(-Dmaven.test.failure.ignore=true clean test); else ARGS+=(-Dtest=$TESTS -Dsurefire.failIfNoSpecifiedTests=false clean test); fi
[ -n "$ARGL" ] && ARGS+=("-DargLine=$ARGL")
t0=$(date +%s)
(cd $WT/packages/sdk-java/$MOD && mvn "${ARGS[@]}" > $LOG 2>&1); rc=$?
t1=$(date +%s)
node $S/mut.mjs $WT NONE > /dev/null
# Per-execution, per-witness verdicts
SUM=$(awk '
  /--- surefire:.*:test \(/ { match($0, /\(([^)]*)\)/); ex=substr($0, RSTART+1, RLENGTH-2) }
  /Tests run:.* -- in / && /(PinningTest|CarrierCount)/ {
    cls=$0; sub(/.* -- in .*\./, "", cls);
    v=($0 ~ /FAILURE|ERROR/) ? "RED" : (($0 ~ /Skipped: [1-9]/) ? "SKIP" : "GREEN");
    t=$0; sub(/.*Time elapsed: /, "", t); sub(/ s.*/, "", t);
    printf "%s:%s=%s(%ss) ", (ex=="default-test"?"default":"pinned"), cls, v, t }
  /COMPILATION ERROR/ { printf "COMPILE-ERROR " }' $LOG)
TOT=$(grep -a -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $LOG | tr '\n' '|' | sed 's/\[[A-Z]*\] Tests run: //g')
MSG=$(grep -a -o -E '(virtual-thread probe starved|virtual threads starved|callers never reached|a caller never finished|streams? .{0,20}starved|probe starved)[^]]{0,120}' $LOG | head -2 | tr '\n' ' ')
printf '%s\trc=%s\t%ss\t%s\t%s\t%s\t%s\n' "$TAG" "$rc" "$((t1-t0))" "$(cat $S/cells/$TAG.mut | tr '\n' ' ')" "$SUM" "$TOT" "$MSG" | tee -a $S/cells/results.tsv
