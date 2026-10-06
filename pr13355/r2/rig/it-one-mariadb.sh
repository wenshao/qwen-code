#!/bin/bash
# VERIFICATION RIG ONLY (PR #13355). usage: it-one.sh <label> <worktree> <m2> <db> <it.test>
set -u
RIG=/Users/wenshao/git/pr13355-rig; L=$1; W=$2; M2=$3; DB=$4; T=$5
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
docker --context colima-pr13336 exec p13355-mariadb mariadb -uroot -p$(cat /Users/wenshao/git/pr13355-rig/.mariadb-pw) -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB"
cd $W/packages/sdk-java/managed-agent-server
TZ=UTC mvn -B -ntp -o -Dmaven.repo.local=$M2 -Pmysql-integration \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:33357/$DB?useSSL=false&allowPublicKeyRetrieval=true" \
  -Dmysql.user=root -Dmysql.password=$(cat /Users/wenshao/git/pr13355-rig/.mariadb-pw) -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false \
  "-Dit.test=$T" -Dcheckstyle.skip -Dspotbugs.skip verify > $RIG/logs/it-maria-$L.log 2>&1
code=$?
printf 'IT-MARIADB\t%s\texit=%s\t%s\n' "$L" "$code" "$(grep -E 'Tests run: [0-9]+, Failures' $RIG/logs/it-maria-$L.log | tail -1)" | tee -a $RIG/results/it.tsv
grep -E "expected|Expecting|but was" $RIG/logs/it-maria-$L.log | head -4
