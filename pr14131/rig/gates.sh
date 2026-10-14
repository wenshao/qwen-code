#!/bin/bash
# usage: gates.sh <arm> <tag>  -- CI "Verify Hosted admission gates" + its report check, then
# "Verify O4 filesystem process and capacity gates" (+ report check); verbatim commands, lane b cpus.
A=$1; TAG=$2; R=/root/pr14131-rig; LOG=$R/out/gates-$A-$TAG.log
DB=gates_${A}_${TAG//[^a-zA-Z0-9]/_}; O4=qwen_o4_${A}_${TAG//[^a-zA-Z0-9]/_}  # O4MySqlGate insists on a dedicated qwen_o4_ database
docker exec pr14131-db mysql -uroot -phosted-fixture -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB; DROP DATABASE IF EXISTS $O4" 2>&1 | grep -v Warning
TMP=$R/tmp-gates-$A-$TAG; rm -rf $TMP; mkdir -p $TMP; chmod 1777 $TMP
echo "=== $(date -u +%FT%TZ) gates arm=$A tag=$TAG" | tee $LOG
cat > $R/out/gates-inner-$A-$TAG.sh <<INNER
cd $R/src-$A
MV="mvn --batch-mode --no-transfer-progress -s /root/pr14131-rig/settings.xml -Dmaven.repo.local=$R/m2 -f packages/sdk-java/managed-agent-server/pom.xml ${EXTRA_MVN:-}"
step() { local name=\$1 limit=\$2; shift 2; local t0=\$(date +%s); echo "### STEP \$name start \$(date -u +%T)";
  timeout \$limit bash -c "\$*"; local rc=\$?; echo "### STEP \$name rc=\$rc wall=\$(( \$(date +%s)-t0 ))s"; }
[ "${SKIP_ADMISSION:-}" = 1 ] || step admission-gates 3000 "\$MV -Phosted-harness-gates -Dnode.executable=\$(command -v node) -Dqwen.cli.entry=$R/src-$A/dist/cli.js '-Dmysql.url=jdbc:mysql://pr14131-db:3306/$DB?allowPublicKeyRetrieval=true&useSSL=false' -Dmysql.user=root -Dmysql.password=hosted-fixture clean verify checkstyle:check"
[ "${SKIP_ADMISSION:-}" = 1 ] || step check-failsafe-gates 120 'node scripts/check-failsafe-reports.js hosted-gates packages/sdk-java/managed-agent-server'
mkdir -p $R/out/fs-gates-$A-$TAG && cp -r packages/sdk-java/managed-agent-server/target/failsafe-reports/. $R/out/fs-gates-$A-$TAG/ 2>/dev/null
[ "${SKIP_O4:-}" = 1 ] || step o4-gates 1200 "mysql --no-defaults --protocol=TCP --host=pr14131-db --port=3306 --user=root -e 'CREATE DATABASE $O4' && \$MV -Po4-mysql-gates '-Dqwen.o4.mysql.url=jdbc:mysql://pr14131-db:3306/$O4?allowPublicKeyRetrieval=true&useSSL=false' -Dqwen.o4.mysql.user=root clean verify checkstyle:check && node scripts/check-failsafe-reports.js o4-mysql packages/sdk-java/managed-agent-server"
mkdir -p $R/out/fs-o4-$A-$TAG && cp -r packages/sdk-java/managed-agent-server/target/failsafe-reports/. $R/out/fs-o4-$A-$TAG/ 2>/dev/null
INNER
docker run --rm --init --name pr14131-gates-$A-$TAG --network pr14131net --cpuset-cpus ${CPUS:-4-7} --memory ${MEM:-6g} --memory-swap ${MEM:-6g} \
  -e QWEN_E2E_REGISTER_STORAGE=1 -e MYSQL_PWD=hosted-fixture -e QWEN_O4_MYSQL_PASSWORD=hosted-fixture \
  -v $R:$R -v $TMP:/tmp -v /etc/machine-id:/etc/machine-id:ro qwen-managed-e2e:u24 bash $R/out/gates-inner-$A-$TAG.sh >> $LOG 2>&1
echo "=== $(date -u +%FT%TZ) gates container exit=$?" >> $LOG
grep -E "^### STEP .* rc=|Tests run: [0-9]+, Fail.*Skipped: [0-9]+$|<<< (FAIL|ERR)" $LOG | cut -c1-200
