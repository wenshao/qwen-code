#!/bin/bash
# VERIFICATION ONLY (PR #13163 R9): base (main d735e20f) control for the Hosted MySQL 8.4 lane flakes seen on head.
set -u
V=/root/verify/pr13163-r9; W=$V/b9; O=$V/out/lanes; mkdir -p $O
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 QWEN_SKIP_PREPARE=1 HUSKY=0 CI=1
export JAVA_HOME=/root/Install/jdk21 PATH=/root/Install/jdk21/bin:/root/Install/apache-maven-3.9.9/bin:$PATH
R="-Dmaven.repo.local=$V/m2b -Dmaven.repo.local.tail=/root/.m2/repository"
cd $W && corepack pnpm install --frozen-lockfile > $O/base-install.log 2>&1; echo "base install exit=$?" >> $O/base.log
(cd $W/packages/sdk-java/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $O/base-java-deps.log 2>&1 && cd ../runtime-broker && mvn -B -ntp -q $R -DskipTests -Dspotbugs.skip=true install >> $O/base-java-deps.log 2>&1); echo "base java deps exit=$?" >> $O/base.log
NODE_OPTIONS=--max-old-space-size=8192 npm run build > $O/base-build.log 2>&1; echo "base build exit=$?" >> $O/base.log
corepack pnpm run bundle > $O/base-bundle.log 2>&1; echo "base bundle exit=$?" >> $O/base.log
for i in 1 2; do
  docker rm -f r9-13163-mysql84b > /dev/null 2>&1
  docker run -d --name r9-13163-mysql84b -e MYSQL_DATABASE=hosted_harness_test -e MYSQL_ROOT_PASSWORD=hosted-fixture -p 127.0.0.1:33964:3306 mysql:8.4.6 > /dev/null
  for j in $(seq 1 90); do docker exec r9-13163-mysql84b mysqladmin ping -h 127.0.0.1 -phosted-fixture > /dev/null 2>&1 && break; sleep 2; done; sleep 5
  S=$(date +%s)
  (cd $W && timeout 2400 mvn --batch-mode --no-transfer-progress $R -f packages/sdk-java/managed-agent-server/pom.xml -Phosted-harness-mysql -Dnode.executable="$(command -v node)" -Dqwen.cli.entry="$W/dist/cli.js" "-Dmysql.url=jdbc:mysql://127.0.0.1:33964/hosted_harness_test?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=hosted-fixture clean verify checkstyle:check > $O/base-hosted-mysql84-run$i.log 2>&1); echo "base hosted run$i exit=$? secs=$(( $(date +%s) - S )) $(grep -E '^\[(ERROR|INFO|WARNING)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $O/base-hosted-mysql84-run$i.log | tail -1)" >> $O/base.log
  grep -E "<<< (FAILURE|ERROR)!$" $O/base-hosted-mysql84-run$i.log | grep -v "Tests run" | sed 's/^/   /' >> $O/base.log
done
docker rm -f r9-13163-mysql84b > /dev/null 2>&1
echo BASE-DONE >> $O/base.log
