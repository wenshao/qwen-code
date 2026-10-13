#!/bin/bash
# usage: java-install.sh <arm> <m2>  — install qwencode-sdk and runtime-broker (with test-jar) from the arm's tree
ARM=$1; M2=$2
BASE=/Users/wenshao/git/pr13974-arms
export JAVA_HOME=$HOME/Install/jdk21
[ -d "$JAVA_HOME/Contents/Home" ] && export JAVA_HOME=$JAVA_HOME/Contents/Home
export PATH=$JAVA_HOME/bin:$HOME/Install/maven/bin:$PATH
cd $BASE/$ARM/packages/sdk-java || exit 2
for mod in qwencode runtime-broker; do
  mvn -o --batch-mode --no-transfer-progress -Dmaven.repo.local=$M2 -f $mod/pom.xml \
    -DskipTests -Dspotbugs.skip=true -Dcheckstyle.skip=true -Djacoco.skip=true -Dgpg.skip=true -Dmaven.javadoc.skip=true -Dmaven.source.skip=true \
    install > $BASE/logs/$ARM-java-install-$mod.log 2>&1
  echo "JAVA $ARM $mod rc=$? $(grep -m1 'BUILD SUCCESS\|BUILD FAILURE' $BASE/logs/$ARM-java-install-$mod.log)"
done
