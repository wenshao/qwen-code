#!/bin/bash
# VERIFICATION RIG ONLY: one IT method alone. usage: it-one.sh <worktree> <label> <Class#method>
R=/Users/wenshao/pr13135-rig; W=$1/packages/sdk-java/managed-agent-server; L=$2; T=$3
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH; export TZ=UTC
DB=p94_one_$(date +%s)
cd $W && mvn -B -ntp -o -Dmaven.repo.local=$R/m2 -Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:33135/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=<local-rig-db-password> \
  -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false "-Dit.test=$T" -Dfailsafe.failIfNoSpecifiedTests=false -Dcheckstyle.skip=true verify > $R/out/p94-itone-$L.log 2>&1
echo "[$L] $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+' $R/out/p94-itone-$L.log | tail -1)"
