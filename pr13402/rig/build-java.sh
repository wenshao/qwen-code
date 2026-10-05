#!/bin/bash
# Usage: build-java.sh <arm>  -> installs qwencode + runtime-broker into m2/<arm>, packages the Spring fat jar
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/54b7ab90-ab14-4aaa-958e-1d2b84bfc2f7/scratchpad
ARM=$1
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:$PATH TZ=UTC
M2=$S/m2/$ARM
[ -d $M2 ] || cp -Rc $S/m2/seed $M2
rm -rf $M2/com/alibaba/qwencode-sdk $M2/com/alibaba/qwen-managed-runtime-broker
cd $S/wt-$ARM/packages/sdk-java || exit 2
LOG=$S/logs/build-java-$ARM.log; : > $LOG
echo "arm=$ARM head=$(git rev-parse HEAD) dirty=$(git status --porcelain | wc -l)" >> $LOG
for m in qwencode runtime-broker; do
  mvn -B -Dmaven.repo.local=$M2 -DskipTests -Dcheckstyle.skip -Dgpg.skip -Dmaven.javadoc.skip -Dmaven.source.skip -f $m/pom.xml clean install >> $LOG 2>&1 || { echo "$ARM $m INSTALL-FAIL"; exit 1; }
done
mvn -B -Dmaven.repo.local=$M2 -DskipTests -Dcheckstyle.skip -f managed-agent-server/pom.xml clean package >> $LOG 2>&1 || { echo "$ARM server PACKAGE-FAIL"; exit 1; }
ls -la managed-agent-server/target/*.jar | grep -v original
shasum -a 256 managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar
echo "$ARM JAVA-BUILD-OK"
