#!/bin/bash
# VERIFICATION ONLY (PR #13163 R9): rerun one Hosted MySQL IT in isolation on a fresh mysql:8.4.6.  usage: it1.sh <worktree> <m2> <IT> <n> <tag>
W=$1; M2=$2; IT=$3; N=$4; T=$5; O=/root/verify/pr13163-r9/out/lanes; mkdir -p $O
export JAVA_HOME=/root/Install/jdk21 PATH=/root/Install/jdk21/bin:/root/Install/apache-maven-3.9.9/bin:$PATH
for i in $(seq 1 $N); do
  docker rm -f r9-13163-it1 > /dev/null 2>&1
  docker run -d --name r9-13163-it1 -e MYSQL_DATABASE=hosted_harness_test -e MYSQL_ROOT_PASSWORD=hosted-fixture -p 127.0.0.1:33963:3306 mysql:8.4.6 > /dev/null
  for j in $(seq 1 90); do docker exec r9-13163-it1 mysqladmin ping -h 127.0.0.1 -phosted-fixture > /dev/null 2>&1 && break; sleep 2; done; sleep 5
  (cd $W && mvn --batch-mode --no-transfer-progress -o -Dmaven.repo.local=$M2 -Dmaven.repo.local.tail=/root/.m2/repository -f packages/sdk-java/managed-agent-server/pom.xml -Phosted-harness-mysql -Dnode.executable="$(command -v node)" -Dqwen.cli.entry="$W/dist/cli.js" "-Dmysql.url=jdbc:mysql://127.0.0.1:33963/hosted_harness_test?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=hosted-fixture -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=$IT verify > $O/it1-$T-$i.log 2>&1)
  echo "$T run $i exit=$? $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $O/it1-$T-$i.log | tail -1)"
done
docker rm -f r9-13163-it1 > /dev/null 2>&1
