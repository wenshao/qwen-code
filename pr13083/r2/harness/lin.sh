#!/bin/bash
# container: assemble a local-disk working copy of the pieces the packaged stack needs from a tree
# (bundle, server jar, runner script, fake model) and run a command there.
# usage: lin.sh <tree> <workdir-name> <command...>
set -u
TREE=$1; W=/w/$2; shift 2
if [ ! -d $W ]; then
  mkdir -p $W/packages/sdk-java/managed-agent-server/target $W/scripts $W/integration-tests
  cp -a /rig/$TREE/dist $W/dist
  cp /rig/$TREE/package.json $W/
  cp /rig/$TREE/scripts/run-managed-agent-server-e2e.ts $W/scripts/
  cp /rig/$TREE/integration-tests/fake-openai-server.ts $W/integration-tests/
  cp /rig/$TREE/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $W/packages/sdk-java/managed-agent-server/target/
  mkdir -p /w/rig && cp /rig/rig/*.ts /rig/rig/package.json /w/rig/ 2>/dev/null
fi
cd $W
exec "$@"
