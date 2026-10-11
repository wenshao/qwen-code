#!/bin/bash
# PR13330 R4 — suites: focused PR-body command at head, then full suites head + base.
R=/root/pr13330-r4
FOCUS="EmbeddedRuntimeBrokerTest,QwenHostedHarnessConnectorTest,HarnessEventProjectorTest,EventIdentityTest,HarnessCoordinatorTest,ManagedSessionLifecycleTest,MessageMaterializerTest,ManagedMaterializationDeferTest"
set -x
# the PR body's focused command, at head
$R/mvn.sh head managed-agent-server 3 8g -Dsurefire.failIfNoSpecifiedTests=false \
  -Dnode.executable=/usr/local/bin/node -Dqwen.cli.entry=$R/cli/dist/cli.js \
  -Dtest=$FOCUS test > $R/logs/focused-head.log 2>&1
echo EXIT=$? >> $R/logs/focused-head.log
# the F1 witness alone, at head (named in the R3 candidate)
$R/mvn.sh head managed-agent-server 3 8g -Dsurefire.failIfNoSpecifiedTests=false \
  -Dnode.executable=/usr/local/bin/node -Dqwen.cli.entry=$R/cli/dist/cli.js \
  -Dtest='EmbeddedRuntimeBrokerTest#acquireOfANewRuntimeSessionIsFencedLikeWarm' test > $R/logs/witness-f1-head.log 2>&1
echo EXIT=$? >> $R/logs/witness-f1-head.log
# full suites
$R/full.sh head runtime-broker managed-agent-server
$R/full.sh base managed-agent-server
echo SUITES_DONE
