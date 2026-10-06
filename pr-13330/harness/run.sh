#!/bin/bash
m=$1
cd /root/verify/pr13330
DOCKER_EXTRA="--cpus=4 --memory=4g" ./mvnd.sh /root/verify/pr13330/mut/$m/packages/sdk-java managed-agent-server -o -Dcheckstyle.skip -Dspotbugs.skip -Djacoco.skip=true test > mut/$m.log 2>&1
echo EXIT=$? >> mut/$m.log
