#!/bin/bash
# usage (inside container): in-container.sh <src-dir> <log> [mvn args...]
SRC=$1; LOG=$2; shift 2
cd /rig/$SRC/packages/sdk-java/managed-agent-server || exit 9
mvn -B -ntp -o -Dmaven.repo.local=/rig/m2 "$@" > /rig/logs/$LOG 2>&1
echo "exit=$?" >> /rig/logs/$LOG
