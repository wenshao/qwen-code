#!/bin/bash
# usage: mysql-it.sh <arm>  -- WorkspaceProfileLifecycleMySqlIT (extends the unit test: 25 inherited + race) on MySQL 8.4 via surefire -Dtest
A=$1; R=/root/pr13931-rig; W=$R/src-$A; DB=myit_$A
docker exec pr13931-db mysql -uroot -phosted-fixture -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB" 2>&1 | grep -v Warning
docker run --rm --init --name pr13931-myit-$A --network pr13931net -v $R:$R qwen-managed-e2e:u24 bash -c "
  cd $W/packages/sdk-java/managed-agent-server && mvn -B -ntp -s $R/settings.xml -Dmaven.repo.local=$R/m2-$A -Dcheckstyle.skip=true -Dspotbugs.skip=true \
    -Dtest=WorkspaceProfileLifecycleMySqlIT -Dsurefire.failIfNoSpecifiedTests=false \
    -Dmysql.url='jdbc:mysql://pr13931-db:3306/$DB?allowPublicKeyRetrieval=true&useSSL=false' -Dmysql.user=root -Dmysql.password=hosted-fixture test" > $R/out/myit-$A.log 2>&1
echo "[$A] mysql-it exit=$?"
grep -E "Tests run:|<<< (FAIL|ERR)" $R/out/myit-$A.log | head -6
