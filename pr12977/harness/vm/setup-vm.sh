#!/bin/bash
# inside VM: install this PR's jars next to the old rig's, keep the old rig's unit/env
set -eu
sudo cp /rig/server/head-server.jar /opt/qwen/pr12977-server.jar
sudo cp /rig/server/head-server-operator-recovery.jar /opt/qwen/pr12977-operator-recovery.jar
sudo cp /rig/server/base-server.jar /opt/qwen/pr12977-base-server.jar
sudo chmod a+r /opt/qwen/pr12977-*.jar
sha256sum /opt/qwen/pr12977-*.jar | cut -c1-16,65-
echo "dist: $(sha256sum /opt/qwen/dist/cli.js | cut -c1-16) vs rig wt-v3 $(sha256sum /rig-12869/wt-v3/dist/cli.js | cut -c1-16)"
diff -rq /opt/qwen/dist /rig-12869/wt-v3/dist | head -3 || true
cat /etc/qwen-w0e3.env
