#!/bin/bash
# usage: server.sh <arm: pr|base|merge|cand> <name> <httpPort> <brokerPort> <db> [spring args...]
ARM=$1; NAME=$2; HTTP=$3; BPORT=$4; DB=$5; shift 5
case "$ARM" in
  pr) JAR=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04201ac3-a139-4b74-bbd7-d1f0edfd79c5/scratchpad/jars/pr-server.jar; WT=/Users/wenshao/git/qwen-code-pr12754 ;;
  merge) JAR=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04201ac3-a139-4b74-bbd7-d1f0edfd79c5/scratchpad/jars/merge-server.jar; WT=/Users/wenshao/git/qwen-code-pr12754-merge ;;
  cand) JAR=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04201ac3-a139-4b74-bbd7-d1f0edfd79c5/scratchpad/jars/cand-server.jar; WT=/Users/wenshao/git/qwen-code-pr12754 ;;
  stale) JAR=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04201ac3-a139-4b74-bbd7-d1f0edfd79c5/scratchpad/rig/../jars/pr-server.jar; WT=$HOME/git/qwen-code-pr12730 ;;
  h2) JAR=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04201ac3-a139-4b74-bbd7-d1f0edfd79c5/scratchpad/jars/h2-server.jar; WT=$HOME/git/qwen-code-pr12754-h2 ;;
  cand2) JAR=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04201ac3-a139-4b74-bbd7-d1f0edfd79c5/scratchpad/jars/cand2-server.jar; WT=$HOME/git/qwen-code-pr12754-h2 ;;
  stale2) JAR=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04201ac3-a139-4b74-bbd7-d1f0edfd79c5/scratchpad/jars/h2-server.jar; WT=$HOME/git/qwen-code-pr12730 ;;
  base) JAR=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04201ac3-a139-4b74-bbd7-d1f0edfd79c5/scratchpad/jars/base-server.jar; WT=/Users/wenshao/git/qwen-code-pr12730 ;;
esac
D=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04201ac3-a139-4b74-bbd7-d1f0edfd79c5/scratchpad/rig/run/$NAME; mkdir -p $D/state
export RIG_LAUNCH_LOG=$D/launches.log
export SPRING_DATASOURCE_URL="jdbc:mysql://127.0.0.1:13754/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false"
export SPRING_DATASOURCE_USERNAME=root SPRING_DATASOURCE_PASSWORD=<local-mysql-password>
export QWEN_MANAGED_AGENT_RUNTIME_BROKER_ENABLED=true QWEN_MANAGED_AGENT_RUNTIME_BROKER_PORT=$BPORT QWEN_MANAGED_AGENT_RUNTIME_BROKER_TOKEN=rig-broker-token
export QWEN_MANAGED_AGENT_RUNTIME_PROVISIONER=local-process QWEN_MANAGED_AGENT_RUNTIME_ISOLATION=session
export QWEN_MANAGED_AGENT_WORKSPACE_CWD=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04201ac3-a139-4b74-bbd7-d1f0edfd79c5/scratchpad/rig/legacy-ws
export QWEN_MANAGED_AGENT_RUNTIME_STATE_DIRECTORY=$D/state
export QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY_ID=rig QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY='<random-32-byte-base64>'
export QWEN_MANAGED_AGENT_NODE_EXECUTABLE=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04201ac3-a139-4b74-bbd7-d1f0edfd79c5/scratchpad/rig/node-wrap.sh
export QWEN_MANAGED_AGENT_RUNTIME_WORKER_ENTRY=$WT/dist/cli.js QWEN_MANAGED_AGENT_CLI_ENTRY=$WT/dist/cli.js
export QWEN_MANAGED_AGENT_CAPABILITY_DIGEST=sha256:<random>
echo "$(date +%H:%M:%S) start arm=$ARM jar=$JAR wt=$WT pid=$$" > $D/server.log
exec /Users/wenshao/Install/jdk21/bin/java -Dloader.path=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04201ac3-a139-4b74-bbd7-d1f0edfd79c5/scratchpad/rig/adapter/adapter.jar -cp $JAR org.springframework.boot.loader.launch.PropertiesLauncher --server.port=$HTTP "$@" >> $D/server.log 2>&1
