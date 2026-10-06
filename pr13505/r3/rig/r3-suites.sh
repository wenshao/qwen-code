#!/bin/bash
# VERIFICATION RIG ONLY (PR #13505 round 3): focused TS on h3/m3; PR store suite on MySQL with h3 code; m3 Java full + ITs; m3 TS full.
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
R=/Users/wenshao/git/pr13505-rig
for a in h3 m3; do
  cd /Users/wenshao/git/pr13505-$a/packages/core; s=$(date +%s)
  npx vitest run src/managed-runtime/managed-child-run-record.test.ts src/managed-runtime/managed-child-acceptance-record.test.ts src/managed-runtime/managed-extension-projection.test.ts src/managed-runtime/managed-session-authority.child-agent.test.ts src/managed-runtime/managed-session-authority.child-run.test.ts src/managed-runtime/local-shell-stream-result-session.test.ts > $R/logs/ts-focused-$a.log 2>&1; c=$?
  printf 'TS\tfocused-6files\t%s\texit=%s\t%ss\t%s\n' $a $c $(( $(date +%s)-s )) "$(grep -E '^ +Tests ' $R/logs/ts-focused-$a.log | tail -1 | tr -s ' ')" | tee -a $R/results/ts.tsv
done
# PR store suite verbatim on MySQL, h3 code (rig-only copy, removed afterwards)
D=/Users/wenshao/git/pr13505-h3/packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent
python3 - <<'PY'
d='/Users/wenshao/git/pr13505-h3/packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/'
src=open(d+'ManagedExtensionRecordStoreTest.java').read()
old='''@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:managed-extension-records;"
                + "MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "qwen.managed-agent.harness.enabled=false"
})
class ManagedExtensionRecordStoreTest {'''
new='''@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:mysql://127.0.0.1:33505/p13505_storetest3?useSSL=false&allowPublicKeyRetrieval=true",
        "spring.datasource.driver-class-name=com.mysql.cj.jdbc.Driver",
        "spring.datasource.username=root",
        "spring.datasource.password=",
        "qwen.managed-agent.harness.enabled=false"
})
class ManagedExtensionRecordStoreOnMySqlTest {'''
assert src.count(old)==1
open(d+'ManagedExtensionRecordStoreOnMySqlTest.java','w').write(src.replace(old,new))
PY
$R/sql.sh -e "DROP DATABASE IF EXISTS p13505_storetest3; CREATE DATABASE p13505_storetest3"
$R/jtest.sh store-on-mysql-h3 /Users/wenshao/git/pr13505-h3 ManagedExtensionRecordStoreOnMySqlTest
rm /Users/wenshao/git/pr13505-h3/packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/ManagedExtensionRecordStoreOnMySqlTest.java
git -C /Users/wenshao/git/pr13505-h3 status --short
$R/suite.sh m3 /Users/wenshao/git/pr13505-m3 $R/m2 p13505_suite_m3
$R/it-all.sh m3 /Users/wenshao/git/pr13505-m3 p13505_it_m3
$R/ts-suite.sh m3
