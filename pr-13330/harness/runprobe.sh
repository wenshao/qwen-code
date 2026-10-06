#!/bin/bash
# usage: runprobe.sh <arm> <tests> <logname> [extra -D...]
arm=$1; tests=$2; log=$3; shift 3
cd /root/verify/pr13330
DOCKER_EXTRA="-v /usr/bin/node:/usr/local/bin/node:ro" ./mvnd.sh /root/verify/pr13330/arms/$arm/packages/sdk-java managed-agent-server -o -Dcheckstyle.skip -Dspotbugs.skip -Djacoco.skip=true -Dsurefire.failIfNoSpecifiedTests=false \
  -Dnode.executable=/usr/local/bin/node -Dqwen.cli.entry=/root/verify/pr13330/wt-pr/dist/cli.js \
  -Dprobe.legacy=/root/verify/pr13330/results/legacy-tool-call.json "-Dtest=$tests" "$@" test > logs/$log.log 2>&1
echo EXIT=$? >> logs/$log.log
