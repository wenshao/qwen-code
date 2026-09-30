#!/bin/bash
# Fast lane (surefire, H2) of managed-agent-server. usage: fast.sh <worktree> <label> <m2> [extra mvn args]
set -u
RIG=/Users/wenshao/pr13112-rig; export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
W=$RIG/$1; L=$2; M2=$RIG/$3; shift 3
O=$RIG/out/fast; mkdir -p $O
S=$(date +%s)
mvn --batch-mode --no-transfer-progress -o -Dmaven.repo.local=$M2 -f $W/packages/sdk-java/managed-agent-server/pom.xml "$@" test > $O/$L.log 2>&1
RC=$?
T=$(grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $O/$L.log | tail -1 | sed -E 's/^\[[A-Z]+\] //')
echo "RESULT fast $L exit=$RC ${T:-no-totals} secs=$(( $(date +%s) - S )) tree=$(git -C $W rev-parse --short HEAD)"
grep -E '^\[ERROR\]   [A-Za-z]+\.[A-Za-z]+:[0-9]+' $O/$L.log | sort -u | cut -c1-220 | sed 's/^/   /'
