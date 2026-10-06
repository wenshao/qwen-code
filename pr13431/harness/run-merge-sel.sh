#!/bin/bash
cd /root/pr13431-rig
for spec in "HostedWorkspaceConcurrencyIT merge-concurrency-alone-1" "HostedWorkspaceConcurrencyIT merge-concurrency-alone-2" "HostedPublicWorkspaceIT merge-public-alone-1" "HostedPublicWorkspaceIT merge-public-alone-2"; do
  set -- $spec
  docker rm -f pr13431-ci-merge >/dev/null 2>&1
  docker run --name pr13431-ci-merge --network host -v /root/pr13431-rig:/rig -v /root/pr13431-rig/machine-id:/etc/machine-id:ro -w /rig --entrypoint bash pr13174-linux:1 -c "git config --global --add safe.directory \"*\"; /rig/ci-hosted.sh merge m2-merge $2 $1 > /rig/out/ci-$2.log 2>&1"
done
echo ALLDONE > out/merge-sel.done
