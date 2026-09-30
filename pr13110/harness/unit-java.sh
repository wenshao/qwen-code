#!/bin/bash
# macOS host, JDK 21: runtime-broker unit tests + checkstyle.  usage: unit-java.sh <worktree> <label>
set -u
. /rig/rig.env
export JAVA_HOME PATH=$JAVA_HOME/bin:$(dirname $NODE):$PATH TZ=UTC
cd $RIG/$1/packages/sdk-java/runtime-broker && mvn -B -ntp -Dmaven.repo.local=$RIG/m2-head clean test checkstyle:check > $RIG/out/unit-$2-broker.log 2>&1; echo "[$2] broker exit=$? $(grep -a -E '^\[(INFO|ERROR|WARNING)\] Tests run: [0-9]+, F' $RIG/out/unit-$2-broker.log | tail -1) $(grep -a -c 'You have 0 Checkstyle violations' $RIG/out/unit-$2-broker.log) checkstyle-ok-lines"
