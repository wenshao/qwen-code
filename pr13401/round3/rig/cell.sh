#!/bin/bash
# Usage: cell.sh <tag> <worktree> <module> <tests|ALL> <probes|NONE> <mutants|NONE> [argLine]
#   M2=<m2 dir name under scratchpad/m2> (default: basename of worktree)
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/ce3ef24d-3ca1-4a59-829e-edeff297be66/scratchpad
TAG=$1; WT=$2; MOD=$3; TESTS=$4; PROBES=$5; MUTS=$6; ARGL=$7
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:$PATH
M2=$S/m2/${M2:-$(basename $WT)}; [ -d $M2 ] || cp -Rc $S/m2/seed $M2
D=$S/r3/cells; mkdir -p $D
git -C $WT checkout -q -- packages/sdk-java
{ node $S/mut.mjs $WT ${MUTS:-NONE} && node $S/r3/probe.mjs $WT ${PROBES:-NONE}; } > $D/$TAG.mut 2>&1 || { echo "$TAG APPLY-FAIL $(cat $D/$TAG.mut)"; git -C $WT checkout -q -- packages/sdk-java; exit 1; }
git -C $WT diff > $D/$TAG.diff
LOG=$D/$TAG.log
ARGS=(-B -o -Dmaven.repo.local=$M2 -Dgpg.skip -Dcheckstyle.skip -Dspotbugs.skip -Djacoco.skip=false)
if [ "$TESTS" = ALL ]; then ARGS+=(-Dmaven.test.failure.ignore=true clean test); else ARGS+=(-Dtest=$TESTS -Dsurefire.failIfNoSpecifiedTests=false -DtrimStackTrace=false clean test); fi
[ -n "$ARGL" ] && ARGS+=("-DargLine=$ARGL")
t0=$(date +%s)
(cd $WT/packages/sdk-java/$MOD && mvn "${ARGS[@]}" > $LOG 2>&1); rc=$?
t1=$(date +%s)
rm -rf $D/$TAG-reports; cp -R $WT/packages/sdk-java/$MOD/target/surefire-reports $D/$TAG-reports 2>/dev/null
git -C $WT checkout -q -- packages/sdk-java
SUM=$(awk '/Tests run:.* -- in / && /(PinningTest|CarrierCount)/ {
    cls=$0; sub(/.* -- in .*\./, "", cls);
    v=($0 ~ /FAILURE|ERROR/) ? "RED" : (($0 ~ /Skipped: [1-9]/) ? "SKIP" : "GREEN");
    t=$0; sub(/.*Time elapsed: /, "", t); sub(/ s.*/, "", t);
    printf "%s=%s(%ss) ", cls, v, t }
  /COMPILATION ERROR/ { printf "COMPILE-ERROR " }' $LOG)
TOT=$(grep -a -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $LOG | tail -1 | sed 's/\[[A-Z]*\] Tests run: //')
REDS=$(awk '/Tests run:.* -- in / && /FAILURE|ERROR/ {c=$0; sub(/.* -- in .*\./, "", c); printf "%s ", c}' $LOG)
MSG=$(grep -a -h -o -E '(AssertionFailedError|AssertionError|IllegalStateException): [^]]{0,170}|Suppressed: [^]]{0,120}|OBSERVE .{0,260}' $LOG | awk '!seen[$0]++' | head -5 | tr '\n' '|')
printf '%s\trc=%s\t%ss\tmut=%s\t%s\ttot=%s\treds=%s\t%s\n' "$TAG" "$rc" "$((t1-t0))" "$(tr '\n' ' ' < $D/$TAG.mut)" "$SUM" "$TOT" "$REDS" "$MSG" | tee -a $D/results.tsv
