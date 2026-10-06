#!/bin/bash
# VERIFICATION RIG ONLY (PR #13355). usage: suite.sh <label> <worktree> <m2> <db>
# Full managed-agent-server unit suite + checkstyle/spotbugs (verify) + the MySQL-profile ITs against the rig's MySQL 8.4.7.
set -u
RIG=/Users/wenshao/git/pr13355-rig; L=$1; W=$2; M2=$3; DB=$4
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
cd $W/packages/sdk-java/managed-agent-server
$RIG/sql.sh -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB"
start=$(date +%s)
TZ=UTC mvn -B -ntp -o -Dmaven.repo.local=$M2 -Pmysql-integration \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:33355/$DB?useSSL=false&allowPublicKeyRetrieval=true" \
  -Dmysql.user=root -Dmysql.password= verify > $RIG/logs/suite-$L.log 2>&1
code=$?
echo "SUITE $L exit=$code $(( $(date +%s) - start ))s"
grep -E "Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$|BUILD|ERROR\]" $RIG/logs/suite-$L.log | tail -12
