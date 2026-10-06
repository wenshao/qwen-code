#!/bin/bash
# usage: runit.sh <arm> <it.test> <logname>
arm=$1; it=$2; log=$3; shift 3
cd /root/verify/pr13330
DOCKER_EXTRA="-v /usr/bin/node:/usr/local/bin/node:ro" ./mvnd.sh /root/verify/pr13330/arms/$arm/packages/sdk-java managed-agent-server -o -Phosted-harness-mysql -Dcheckstyle.skip -Dspotbugs.skip -Djacoco.skip=true -Dtest=__none__ -Dsurefire.failIfNoSpecifiedTests=false -Dfailsafe.failIfNoSpecifiedTests=false \
  -Dnode.executable=/usr/local/bin/node -Dqwen.cli.entry=/root/verify/pr13330/wt-pr/dist/cli.js "-Dit.test=$it" "$@" verify > logs/$log.log 2>&1
echo EXIT=$? >> logs/$log.log
