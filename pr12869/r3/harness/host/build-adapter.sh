#!/bin/bash
# Build the rig auth adapter against the head server jar.
set -eu
cd /tmp
rm -rf adapter && mkdir -p adapter/classes
cd adapter
jar xf /rig/server/r3-head-server.jar && mkdir -p server && mv BOOT-INF META-INF org server/ 2>/dev/null || true
CP="server/BOOT-INF/classes:$(ls server/BOOT-INF/lib/*.jar | tr '\n' ':')"
mkdir -p src/com/alibaba/qwen/code/managedagent/rig
cp /rig/vm/adapter-src/src/com/alibaba/qwen/code/managedagent/rig/RigActorConfig.java src/com/alibaba/qwen/code/managedagent/rig/
javac -cp "$CP" -d classes src/com/alibaba/qwen/code/managedagent/rig/RigActorConfig.java
jar cf /rig/server/adapter.jar -C classes .
echo "adapter.jar: $(ls -la /rig/server/adapter.jar | awk '{print $5}') bytes"
