#!/bin/bash
# usage: spring.sh <db> <httpPort> <jar-tag>   (native MySQL 8.4.7 on 127.0.0.1:13266)
DB=$1; HTTP=$2; TAG=$3
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad
exec ~/Install/jdk21/bin/java -Duser.timezone=UTC -jar $SP/jars/$TAG-server.jar \
  --server.address=127.0.0.1 --server.port=$HTTP \
  "--spring.datasource.url=jdbc:mysql://127.0.0.1:13266/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  --spring.datasource.username=root --spring.datasource.password=<local-rig-password> \
  --qwen.managed-agent.session-store.enabled=true \
  --qwen.managed-agent.harness.enabled=false \
  --qwen.managed-agent.trusted-actor-header=X-Rig-Actor
