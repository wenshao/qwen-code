#!/bin/bash
# VERIFICATION RIG ONLY: ToolPublicationRecoveryMySqlIT alone. usage: it-recovery.sh <worktree> <label> [tz]
R=/Users/wenshao/pr13135-rig; W=$1/packages/sdk-java/managed-agent-server; L=$2; TZV=${3:-}
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
[ -n "$TZV" ] && export TZ=$TZV
X=""; [ -n "$TZV" ] && X="-DargLine=-Duser.timezone=$TZV"
cd $W && mvn -B -ntp -o -Dmaven.repo.local=$R/m2 -Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:33135/p94_it?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=<local-rig-db-password> \
  -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=ToolPublicationRecoveryMySqlIT -Dfailsafe.failIfNoSpecifiedTests=false $X -Dcheckstyle.skip=true verify > $R/out/p94-itrec-$L.log 2>&1
echo "[$L tz=${TZV:-local}] $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+' $R/out/p94-itrec-$L.log | tail -1)"
