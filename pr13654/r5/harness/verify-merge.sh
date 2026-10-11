#!/bin/bash
# Round 5: CI's managed-agent-server command on the local merge, against MySQL 8.4.7 (CI uses MariaDB 10.11.18).
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8b5b6f90-8800-48da-9e9c-05b8ecdac3c5/scratchpad; R=$S/rig; W=${W:-$HOME/git/qwen-code-pr13654-merge}; TAG=${TAG:-merge5}
cd $W/packages/sdk-java/managed-agent-server || exit 1; echo "at $(git rev-parse --short HEAD) $(date +%T)"
$R/mvn-merge.sh -Pmysql-integration \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:13654/${DBN:-p654m5it}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rig13654 \
  -Dmaven.test.failure.ignore=true clean verify checkstyle:check > $S/r5/verify-$TAG.log 2>&1
echo "mvn exit=$? $(date +%T)"
rm -rf $S/r5/reports-$TAG; mkdir -p $S/r5/reports-$TAG; cp target/surefire-reports/TEST-*.xml target/failsafe-reports/TEST-*.xml $S/r5/reports-$TAG/ 2>/dev/null
python3 $S/r5/summ-total.py $S/r5/reports-$TAG
grep -E 'Tests run:.*Fail|BUILD|ERROR\]|checkstyle|You have [0-9]+ Checkstyle' $S/r5/verify-$TAG.log | tail -15
