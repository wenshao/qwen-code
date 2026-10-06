#!/bin/bash
# VERIFICATION RIG ONLY (PR #13505). usage: it-all.sh <label> <worktree> <db>
# Every mysql-integration IT (failsafe; Hosted*IT excluded by the profile) on native MySQL 8.4.7, unit tests skipped.
set -u
RIG=/Users/wenshao/git/pr13505-rig; L=$1; W=$2; DB=$3
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
$RIG/sql.sh -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB"
cd $W/packages/sdk-java/managed-agent-server; s=$(date +%s)
TZ=UTC mvn -B -ntp -o -Dmaven.repo.local=$RIG/m2 -Pmysql-integration \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:33505/$DB?useSSL=false&allowPublicKeyRetrieval=true" \
  -Dmysql.user=root -Dmysql.password= -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false \
  -Dcheckstyle.skip -Dspotbugs.skip verify > $RIG/logs/it-$L.log 2>&1
code=$?
printf 'IT\t%s\texit=%s\t%ss\t%s\n' "$L" "$code" $(( $(date +%s)-s )) "$(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $RIG/logs/it-$L.log | tail -1)" | tee -a $RIG/results/it.tsv
grep -E "Tests run:.*in com" $RIG/logs/it-$L.log | sed 's/.*Tests run/Tests run/' 
