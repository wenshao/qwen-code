#!/bin/bash
# Build the Java SDK, Runtime Broker and the Managed Agent server fat jars at the PR head with JDK 21.
set -u
export JAVA_HOME=/root/Install/jdk21 PATH=/root/Install/jdk21/bin:/root/Install/maven/bin:$PATH
SJ=/root/verify/pr13260/head/packages/sdk-java; O=/root/verify/pr13260/logs; R="-Dmaven.repo.local=/root/verify/pr13260/m2/repository"
(cd $SJ/qwencode && mvn -B -ntp $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $O/java-qwencode.log 2>&1); echo "qwencode install exit=$?"
(cd $SJ/runtime-broker && mvn -B -ntp $R -DskipTests -Dcheckstyle.skip=true clean install > $O/java-broker.log 2>&1); echo "broker install exit=$?"
(cd $SJ/managed-agent-server && mvn -B -ntp $R -DskipTests clean package > $O/java-server.log 2>&1); echo "server package (with checkstyle) exit=$?"
ls -la $SJ/managed-agent-server/target/*.jar
echo JAVA-BUILD-DONE
