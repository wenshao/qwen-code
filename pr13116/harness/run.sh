#!/bin/bash
# managed-agent-server surefire run. usage: run.sh <worktree> <m2> <label> [-Dtest=...] [extra goals/args]
# Prints one RESULT line plus every failing test location.
set -u
. /Users/wenshao/pr13116-rig/scripts/env.sh
W=$RIG/$1; M=$RIG/$2; L=$3; shift 3
S=$(date +%s)
mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=$M -f $W/$MA/pom.xml "$@" > $RIG/out/$L.log 2>&1
RC=$?
T=$(/usr/bin/grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $RIG/out/$L.log | tail -1 | sed -E 's/^\[[A-Z]+\] //')
echo "RESULT $L exit=$RC ${T:-no-totals} secs=$(( $(date +%s) - S )) tree=$(git -C $W rev-parse --short=10 HEAD) dirty=$(git -C $W status --porcelain -- $MA | wc -l | tr -d ' ')"
/usr/bin/grep -E '^\[ERROR\]   [A-Za-z]+\.[A-Za-z]+:[0-9]+' $RIG/out/$L.log | sort -u | cut -c1-260 | sed 's/^/   /'
