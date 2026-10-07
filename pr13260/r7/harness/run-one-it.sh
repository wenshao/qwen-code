#!/bin/bash
# container: run one MySQL IT class against the VM MySQL 8.4.  usage: run-one-it.sh <tree> <label> <IT class>
set -u
TREE=$1; L=$2; IT=$3; O=/rig/out/it; mkdir -p $O; W=/it-$L; SJ=$W/packages/sdk-java
rm -rf $W && mkdir -p $W && cp -a /rig/$TREE/. $W/; R="-Dmaven.repo.local=/root/.m2/repository"
(cd $SJ/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $O/$L.log 2>&1)
(cd $SJ/runtime-broker && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true install >> $O/$L.log 2>&1)
cd $SJ/managed-agent-server
mvn -B -ntp $R -Pmysql-integration -Dtest=NoSuchTest -Dit.test=$IT -Dsurefire.failIfNoSpecifiedTests=false -Dfailsafe.failIfNoSpecifiedTests=false \
  "-Dmysql.url=${ITURL:-jdbc:mysql://127.0.0.1:3306/mysql?allowPublicKeyRetrieval=true&useSSL=false}" -Dmysql.user=root -Dmysql.password=${ITPASS:-rootpw} verify >> $O/$L.log 2>&1
echo "[$L] exit=$?"; grep -E "Tests run:.*-- in |<<< FAIL" $O/$L.log | tail -4
