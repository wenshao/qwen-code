#!/bin/bash
S=$(dirname "$0"); W=/Users/wenshao/git/qwen-code-pr13297-merge
export JAVA_HOME=$HOME/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
cd $W && { npm run bundle; echo "bundle rc=$?"; } > $S/merge-bundle.log 2>&1
ls -la $W/dist/cli.js >> $S/merge-bundle.log 2>&1
(cd $W/integration-tests && { npx vitest run cli/hosted-harness-process.test.ts; echo "integ rc=$?"; } > $S/merge-integ-hosted.log 2>&1)
M=(mvn -o --batch-mode --no-transfer-progress -Dmaven.repo.local=$S/m2-merge -f packages/sdk-java/runtime-broker/pom.xml)
{ "${M[@]}" -Pfault-gates -Dqwen.cli.entry=$W/dist/cli.js test; echo "faultgates rc=$?"; } > $S/merge-faultgates.log 2>&1
{ "${M[@]}" -Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:33297/runtime_broker_r3_$(date +%s)?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=rig -Dmysql.password=rig -Dspotbugs.skip=true clean verify; echo "mysqlit rc=$?"; } > $S/merge-mysqlit.log 2>&1
tail -1 $S/merge-bundle.log; grep -E "Tests +[0-9]|integ rc" $S/merge-integ-hosted.log | tail -2; grep -E "Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$|rc=" $S/merge-faultgates.log $S/merge-mysqlit.log
