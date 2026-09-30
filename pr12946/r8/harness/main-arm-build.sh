#!/bin/bash
set -e
S=<scratch>
export PATH=$HOME/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
export JAVA_HOME=/opt/homebrew/opt/openjdk@25
cd $S; test -e wt-main8 || cp -Rc wt-r7arm wt-main8
cd $S/wt-pr; git diff --name-only --diff-filter=A 568d98872f d472033c93 > $S/main8-extra.txt
cd $S/wt-main8; xargs rm -f < $S/main8-extra.txt
cd $S/wt-pr; git archive 568d98872f | tar -x -C $S/wt-main8
cd $S/wt-main8; npm run build > $S/build-main8.log 2>&1; npm run bundle >> $S/build-main8.log 2>&1; echo TS_OK >> $S/build-main8.log
test -e $S/m2-main || cp -Rc $S/m2 $S/m2-main
M="mvn -q -B -Dgpg.skip -Dmaven.repo.local=$S/m2-main"
cd $S/wt-main8/packages/sdk-java/qwencode && $M -DskipTests install
cd $S/wt-main8/packages/sdk-java/runtime-broker && $M -DskipTests clean install
cd $S/wt-main8/packages/sdk-java/managed-agent-server && $M -DskipTests clean package
sed "s#$S/m2/#$S/m2-main/#g" $S/cp.txt > $S/cp-main.txt
echo MAIN_BUILD_OK >> $S/build-main8.log
