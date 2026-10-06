#!/bin/bash
# Builds the managed-agent-server jar from the PR tree (the PR changes no Java).
set -euo pipefail
R=/Users/wenshao/git/pr13332-rig
M=$R/mvn.sh
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
cd /Users/wenshao/git/pr13332-head/packages/sdk-java
(cd qwencode && $M -B -ntp -q -o -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true clean install)
(cd runtime-broker && $M -B -ntp -q -o -DskipTests -Dcheckstyle.skip=true -Dspotbugs.skip=true clean install)
cd managed-agent-server
$M -B -ntp -q -o -DskipTests -Dcheckstyle.skip=true -Dspotbugs.skip=true clean package
cp target/qwen-managed-agent-server-0.1.0-alpha.jar $R/jars/server-$(git rev-parse --short=10 HEAD).jar
ls -la $R/jars
