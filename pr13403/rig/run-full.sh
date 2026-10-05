#!/bin/bash
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:$PATH TZ=UTC
cd /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/594cd89e-25a1-4d3d-a569-2769a54ddb61/scratchpad/wt-full
$HOME/Install/mysql-8.4.7-macos15-arm64/bin/mysql --protocol=tcp -h127.0.0.1 -P13403 -uroot -e 'CREATE DATABASE IF NOT EXISTS it13403'
mvn -B -Dmaven.repo.local=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/594cd89e-25a1-4d3d-a569-2769a54ddb61/scratchpad/m2/shared -Phosted-harness-mysql -Dit.test=HostedConcurrentTurnBurstMySqlIT "-Dmysql.url=jdbc:mysql://127.0.0.1:13403/it13403?useSSL=false&allowPublicKeyRetrieval=true" -f packages/sdk-java/managed-agent-server/pom.xml verify checkstyle:check > /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/594cd89e-25a1-4d3d-a569-2769a54ddb61/scratchpad/full-verify.log 2>&1
echo "FULL-EXIT $?" >> /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/594cd89e-25a1-4d3d-a569-2769a54ddb61/scratchpad/full-verify.log
