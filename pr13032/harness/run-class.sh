#!/bin/bash
# usage: run-class.sh <worktree> <m2repo> <log> [extra mvn args...]
export JAVA_HOME=/Users/wenshao/Install/jdk21
export PATH=$JAVA_HOME/bin:$PATH
W=$1; R=$2; L=$3; shift 3
cd $W/packages/sdk-java/managed-agent-server || exit 9
mvn -B -ntp -o -Dmaven.repo.local=$R "$@" > $L 2>&1
echo "exit=$?" >> $L
