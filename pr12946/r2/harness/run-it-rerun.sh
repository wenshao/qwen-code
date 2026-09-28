#!/bin/bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@25
NODE22=$HOME/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
docker exec pr12946-mysql mysql -uroot -prig12946 -e "drop database if exists hosted_harness_rerun; create database hosted_harness_rerun" 2>/dev/null
cd $SCRATCH/wt-pr/packages/sdk-java/managed-agent-server && mvn --batch-mode --no-transfer-progress -Dgpg.skip -Dmaven.repo.local=$SCRATCH/m2 -Phosted-harness-mysql -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false "-Dit.test=HostedWorkspaceToolTurnIT#sessionStoreFailuresNeverReplayEffectsOnMySql+packagedHarnessUsesSavedWorkspacesThroughRealBrokerWorkerAndSqlStore"   -Dnode.executable=$NODE22 -Dqwen.cli.entry=$SCRATCH/wt-pr/dist/cli.js   "-Dmysql.url=jdbc:mysql://127.0.0.1:13946/hosted_harness_rerun?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rig12946 verify
