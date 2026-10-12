#!/bin/bash
# usage: unit-java.sh <arm>  -- managed-agent-server lifecycle unit tests + WorkspaceProfileLifecycleMySqlIT only
A=$1; R=/root/pr13931-rig; W=$R/src-$A; DB=unitj_$A
docker exec pr13931-db mysql -uroot -phosted-fixture -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB" 2>&1 | grep -v Warning
docker run --rm --init --name pr13931-unitj-$A --network pr13931net -v $R:$R qwen-managed-e2e:u24 bash -c "
  cd $W/packages/sdk-java/managed-agent-server && mvn -B -ntp -s $R/settings.xml -Dmaven.repo.local=$R/m2-$A -Dcheckstyle.skip=true -Dspotbugs.skip=true \
    -Dtest='WorkspaceProfileLifecycleTest' -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=WorkspaceProfileLifecycleMySqlIT \
    -Dmysql.url='jdbc:mysql://pr13931-db:3306/$DB?allowPublicKeyRetrieval=true&useSSL=false' -Dmysql.user=root -Dmysql.password=hosted-fixture verify" > $R/out/unitj-$A.log 2>&1
echo "[$A] unit-java exit=$?"
grep -E "Tests run:|<<< (FAIL|ERR)|\[ERROR\]   " $R/out/unitj-$A.log | head -14
