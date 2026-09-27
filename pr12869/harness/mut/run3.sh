#!/bin/bash
# third pass: broker MySQL IT only, for broker-module mutants that survived everything else
set -u
OUT=/rig/out/mut3; mkdir -p $OUT
failing() { grep -E '<<< (FAILURE|ERROR)!' "$1" | grep -v -E ' in com\.' | sed -E 's/^\[ERROR\] +//; s/ -- Time elapsed.*//' | sed -E 's/com\.alibaba\.qwen\.code\.(runtimebroker|managedagent)\.//' | sort -u | tr '\n' ';'; }
W=/w3; rm -rf $W && mkdir -p $W && cp -a /rig/src-v2/. $W/
SJ=$W/packages/sdk-java
(cd $SJ/qwencode && mvn -B -ntp -q -DskipTests -Dgpg.skip=true install >/dev/null 2>&1)
for id in $MUTANTS; do
  file=packages/sdk-java/runtime-broker/pom.xml
  [ "$id" = BASE ] || file=$(node -e "import('/rig/mut/mutants.mjs').then(m=>console.log(m.MUTANTS.find(x=>x.id==='$id').file))")
  cp /rig/src-v2/$file $W/$file
  [ "$id" = BASE ] || node /rig/mut/apply.mjs $W $id > $OUT/$id.apply.log 2>&1
  (cd $SJ/runtime-broker && mvn -B -ntp verify -Pmysql-integration -Dcheckstyle.skip=true -Dtest=JdbcRepositoryTest "-Dmysql.url=jdbc:mysql://127.0.0.1:${MYSQL_PORT:-3306}/m3_${id}_$(date +%s)?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rootpw > $OUT/$id.mysql-broker.log 2>&1) && r=pass || r=FAIL
  echo "[$id] mysqlBrokerIT=$r $(grep -E 'Tests run:.*-- in .*MySqlIT' $OUT/$id.mysql-broker.log | sed -E 's/^\[[A-Z]+\] //; s/, Time elapsed.*//') $(failing $OUT/$id.mysql-broker.log)"
  cp /rig/src-v2/$file $W/$file
done
echo MUT3-DONE
