#!/bin/bash
# usage: run-arm.sh <tree> <label> [selector]  — container per run, same flags as the merge arm
cd /root/pr13431-rig
docker rm -f pr13431-ci-$1 >/dev/null 2>&1
docker run -d --name pr13431-ci-$1 --network host -v /root/pr13431-rig:/rig -v /root/pr13431-rig/machine-id:/etc/machine-id:ro -w /rig --entrypoint bash pr13174-linux:1 -c "git config --global --add safe.directory \"*\"; /rig/ci-hosted.sh $1 m2-bh $2 $3 > /rig/out/ci-$2.log 2>&1"
