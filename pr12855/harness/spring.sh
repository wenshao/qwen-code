#!/bin/bash
# usage: spring.sh <db> <httpPort> [jar-tag]   (MariaDB 10.11.18 in docker on 127.0.0.1:13855)
DB=$1; HTTP=$2; TAG=${3:-pr}; shift $(( $# < 3 ? $# : 3 ))
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/f6f165f1-2767-4012-bf7c-2c22899a4751/scratchpad
exec ~/Install/jdk21/bin/java ${JVM_OPTS:-} -Dloader.path=$SP/rig/adapter/adapter.jar -cp $SP/jars/$TAG-server.jar org.springframework.boot.loader.launch.PropertiesLauncher \
  --server.address=127.0.0.1 --server.port=$HTTP \
  "--spring.datasource.url=jdbc:mysql://127.0.0.1:13855/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  --spring.datasource.username=root --spring.datasource.password=rig12855 \
  --qwen.managed-agent.session-store.enabled=true \
  --qwen.managed-agent.harness.enabled=false \
  "$@"
