#!/bin/bash
# VERIFICATION RIG ONLY: survivors of the focused run against wider suites.
set -u
RIG=/Users/wenshao/pr13247-rig; NODE=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
export JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:$PATH TZ=UTC
MY="jdbc:mysql://127.0.0.1:33247/DBNAME?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false"
ret() { echo "[\"-Pmysql-integration\",\"-Dit.test=WorkspaceSessionRetentionMySqlIT\",\"-Dtest=NoSuchTest\",\"-Dsurefire.failIfNoSpecifiedTests=false\",\"-Dcheckstyle.skip\",\"-Dmysql.url=${MY/DBNAME/$1}\",\"-Dmysql.user=root\",\"-Dmysql.password=<redacted>\",\"verify\"]"; }
# control: unmutated head
cd $RIG/wt-mut/packages/sdk-java/managed-agent-server
mvn -B -ntp -o -Dmaven.repo.local=$RIG/m2-mut $(echo $(ret rt_head) | $NODE -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).join(" ")))') > $RIG/results/mutation/CONTROL-retention-it.log 2>&1
echo "CONTROL retention IT exit=$? $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $RIG/results/mutation/CONTROL-retention-it.log | tail -1)"
MUT_SUFFIX=-retention-it MUT_ARGS="$(ret rt_m18b)" MUT_TREE=$RIG/wt-mut MUT_M2=$RIG/m2-mut $NODE $RIG/probe/mutate.mjs M18b
MUT_SUFFIX=-full-unit MUT_ARGS='["-Dcheckstyle.skip","test"]' MUT_TREE=$RIG/wt-mut MUT_M2=$RIG/m2-mut $NODE $RIG/probe/mutate.mjs M15 M17
MUT_SUFFIX=-hosted-it MUT_ARGS="[\"-Phosted-harness-mysql\",\"-Dit.test=HostedPublicWorkspaceIT\",\"-Dtest=NoSuchTest\",\"-Dsurefire.failIfNoSpecifiedTests=false\",\"-Dcheckstyle.skip\",\"-Dnode.executable=$NODE\",\"-Dqwen.cli.entry=$RIG/wt/dist/cli.js\",\"verify\"]" MUT_TREE=$RIG/wt-mut MUT_M2=$RIG/m2-mut $NODE $RIG/probe/mutate.mjs M15
