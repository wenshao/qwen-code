#!/bin/bash
# usage: spring.sh <db> <httpPort> [jar-tag]
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/61c44e46-1821-4cde-80cb-61ff1d2e90e3/scratchpad
DB=$1; HTTP=$2; TAG=${3:-pr}
[ -n "$DB" ] && [ -n "$HTTP" ] || exit 2
exec ~/Install/jdk21/bin/java -Duser.timezone=UTC -jar $S/jars/$TAG-server.jar \
  --server.address=127.0.0.1 --server.port=$HTTP \
  "--spring.datasource.url=jdbc:mysql://127.0.0.1:13345/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  --spring.datasource.username=root --spring.datasource.password=rig13345 \
  --qwen.managed-agent.session-store.enabled=true \
  --qwen.managed-agent.harness.enabled=false
