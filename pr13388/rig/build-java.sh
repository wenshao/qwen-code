#!/bin/bash
# Usage: build-java.sh <arm> [offline]  -> installs qwencode + runtime-broker into m2/<arm>, packages the Spring fat jar
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/412871d7-f412-4b9c-905e-0d2a8afab8a8/scratchpad
ARM=$1; OFF=${2:+-o}
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:$PATH TZ=UTC
M2=$S/m2/$ARM
[ -d $M2 ] || cp -Rc $S/m2/seed $M2
rm -rf $M2/com/alibaba/qwencode-sdk $M2/com/alibaba/qwen-managed-runtime-broker
cd $S/wt-$ARM/packages/sdk-java || exit 2
LOG=$S/build-java-$ARM.log; : > $LOG
for m in qwencode runtime-broker; do
  mvn -B $OFF -Dmaven.repo.local=$M2 -DskipTests -Dcheckstyle.skip -Dgpg.skip -Dmaven.javadoc.skip -Dmaven.source.skip -f $m/pom.xml clean install >> $LOG 2>&1 || { echo "$ARM $m INSTALL-FAIL"; exit 1; }
done
mvn -B $OFF -Dmaven.repo.local=$M2 -DskipTests -Dcheckstyle.skip -f managed-agent-server/pom.xml clean package >> $LOG 2>&1 || { echo "$ARM server PACKAGE-FAIL"; exit 1; }
ls -la managed-agent-server/target/*.jar | grep -v original
echo "$ARM JAVA-BUILD-OK"
