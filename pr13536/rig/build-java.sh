#!/bin/bash
# VERIFICATION RIG ONLY (PR #13536): build qwencode + runtime-broker + managed-agent-server jar from one worktree.
# usage: build-java.sh <label> <worktree> <m2> [online]
set -u
RIG=/Users/wenshao/git/pr13536-rig; L=$1; W=$2; M2=$3; OFF=-o; [ "${4:-}" = online ] && OFF=
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
R="-Dmaven.repo.local=$M2"; O=$RIG/logs/build-java-$L.log; SJ=$W/packages/sdk-java
: > $O
(cd $SJ/qwencode && mvn -B -ntp -q $OFF $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true clean install >> $O 2>&1); echo "[$L] qwencode install exit=$?"
(cd $SJ/runtime-broker && mvn -B -ntp -q $OFF $R -DskipTests -Dcheckstyle.skip=true -Dspotbugs.skip=true clean install >> $O 2>&1); echo "[$L] broker install exit=$?"
(cd $SJ/managed-agent-server && mvn -B -ntp -q $OFF $R -DskipTests -Dcheckstyle.skip=true -Dspotbugs.skip=true clean package >> $O 2>&1); echo "[$L] server package exit=$?"
j=$RIG/jars/server-$L-$(git -C $W rev-parse --short=10 HEAD).jar
cp $SJ/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $j
echo "== $j sha256=$(shasum -a 256 $j | cut -c1-16)"
echo "[$L] BUILD-DONE $(date -u +%T)"
