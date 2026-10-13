#!/bin/bash
# usage: run-arm.sh <arm> <test> [extra -D args...]
set -uo pipefail
arm=$1; test=$2; shift 2
cd /rig/$arm/packages/sdk-java/managed-agent-server
mvn -o -B -ntp -s /rig/settings.xml -Dmaven.repo.local=/rig/m2 surefire:test -Dtest="$test" -DtrimStackTrace=false -Dstress.arm=$arm "$@"
