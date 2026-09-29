#!/bin/bash
# Build adapter.jar (Spring loader.path extension that maps X-Rig-Actor to an authenticated tenant actor).
# usage: build-adapter.sh <path/to/qwen-managed-agent-server.jar>
set -e
JAR=$1; D=$(mktemp -d)
(cd $D && unzip -q -o "$JAR" 'BOOT-INF/lib/*' 'BOOT-INF/classes/*')
mkdir -p $D/cls $D/src/com/alibaba/qwen/code/managedagent/rig
cp "$(dirname $0)/RigActorConfig.java" $D/src/com/alibaba/qwen/code/managedagent/rig/
CP="$D/BOOT-INF/classes:$(ls $D/BOOT-INF/lib/*.jar | tr '\n' ':')"
/opt/jdk21/bin/javac -d $D/cls -cp "$CP" $D/src/com/alibaba/qwen/code/managedagent/rig/RigActorConfig.java
/opt/jdk21/bin/jar cf "$(dirname $0)/adapter.jar" -C $D/cls .
echo "built $(dirname $0)/adapter.jar"
