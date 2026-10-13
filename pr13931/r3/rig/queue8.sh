#!/bin/bash
# round 3 (exact head 86656d10): build head3 + merge3 (head3 + main 6373fc4e), then the round-2 regression recipe
R=/root/pr13931-rig
echo "=== $(date +%T) queue8 start"
docker start pr13931-db >/dev/null
until docker exec pr13931-db mysqladmin -uroot -phosted-fixture ping 2>/dev/null | grep -q alive; do sleep 3; done
echo "db up"
$R/run-build.sh head3 & B1=$!
$R/run-build.sh merge3 & B2=$!
wait $B1; echo "build head3 container exit=$?"
wait $B2; echo "build merge3 container exit=$?"
grep -h "exit=" $R/out/build-head3.log $R/out/build-merge3.log
$R/build-jar.sh head3 & J1=$!
$R/build-jar.sh merge3 & J2=$!
wait $J1 $J2
echo "=== $(date +%T) BUILDS-DONE"
( $R/run-rig.sh l4 head3
  $R/run-rig.sh l4x head3
  $R/run-rig.sh v1off head3
  $R/run-it.sh head3 r1 "HostedPublicWorkspaceIT#publicShellV2DeletionTriggersCollectionWithoutRetirementSeams"
  $R/unit.sh head3
  echo "=== $(date +%T) LANE-A-DONE" ) > $R/out/q8-laneA.log 2>&1 & LA=$!
( $R/run-rig.sh l4 merge3
  $R/run-rig.sh l4x merge3
  $R/run-it.sh merge3 full HostedPublicWorkspaceIT
  $R/unit.sh merge3
  echo "=== $(date +%T) LANE-B-DONE" ) > $R/out/q8-laneB.log 2>&1 & LB=$!
wait $LA $LB
echo "=== $(date +%T) QUEUE8-DONE"
