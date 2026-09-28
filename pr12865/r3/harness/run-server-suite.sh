#!/bin/bash
set -u
printf '%s\n' "$1" > /etc/machine-id
rm -rf /work && mkdir -p /work && cp -a /rig/src/. /work/
cd /work/packages/sdk-java/managed-agent-server
mvn -o -B -ntp test > /rig/out/${SUITE_LOG:-s1-server}.log 2>&1; echo "server suite exit=$?"
grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' /rig/out/${SUITE_LOG:-s1-server}.log | tail -1
