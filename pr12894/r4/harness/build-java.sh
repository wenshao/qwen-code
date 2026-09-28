#!/bin/bash
# Round 4: build the PR's Java modules (runtime-broker install, then the
# managed-agent-server Spring Boot jar) with JDK 21 on this Linux host.
set -x
export JAVA_HOME=/root/Install/jdk21
export PATH=/root/Install/jdk21/bin:$PATH
MVN=/root/Install/maven/bin/mvn
SDK=/root/git/qwen-code-x3/tmp/pr12894-verify-20260928-205039/head/packages/sdk-java
OUT=/root/git/qwen-code-x3/tmp/pr12894-verify-20260928-205039/results
cd "$SDK" || exit 9
$MVN -B -f runtime-broker/pom.xml install -DskipTests > "$OUT/maven-broker.log" 2>&1
echo "BROKER_EXIT=$?" | tee -a "$OUT/maven.log"
$MVN -B -f managed-agent-server/pom.xml package -DskipTests > "$OUT/maven-server.log" 2>&1
echo "SERVER_EXIT=$?" | tee -a "$OUT/maven.log"
ls -la managed-agent-server/target/*.jar >> "$OUT/maven.log" 2>&1
