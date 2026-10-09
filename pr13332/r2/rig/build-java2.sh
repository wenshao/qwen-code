#!/bin/bash
# usage: build-java2.sh <worktree-arm> <label> [online]  -- jar into rig/jars and the arm's target/
R=/Users/wenshao/git/pr13332-rig; A=$1; L=$2; OFF=-o; [ "${3:-}" = online ] && OFF=
M=$R/mvn.sh
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
cd /Users/wenshao/git/pr13332-$A/packages/sdk-java || exit 1
(cd qwencode && $M -B -ntp -q $OFF -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true clean install) || exit 2
(cd runtime-broker && $M -B -ntp -q $OFF -DskipTests -Dcheckstyle.skip=true -Dspotbugs.skip=true clean install) || exit 3
(cd managed-agent-server && $M -B -ntp -q $OFF -DskipTests -Dcheckstyle.skip=true -Dspotbugs.skip=true clean package) || exit 4
cp managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $R/jars/server-$L-$(git rev-parse --short=10 HEAD).jar
echo "built $L $(shasum -a 256 managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar | cut -c1-16)"
