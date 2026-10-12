#!/bin/bash
# New head 5832d882: trial merge 9a04ef15 (= 5832d882 + main 18f80f56). Rebuild with JDK 21, jar diff, probes, unit suite, mutation, ITs.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
MVN="mvn -o --batch-mode --no-transfer-progress -Dmaven.repo.local=$S/m2-r10b"
O=$S/r10/results; J=$S/jars/merge-r10b-9a04ef15.jar
cd $S/wt-r10b; echo "merge $(git rev-parse --short HEAD) parents $(git log -1 --format=%p HEAD) tree $(git rev-parse --short HEAD^{tree})"
[ "$(git rev-parse HEAD^{tree})" = 79e5d6f1caa5bc21adfccab20306f7ad88b61fc0 ] || { echo "TREE MISMATCH"; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "DIRTY"; exit 1; }
rm -rf packages/sdk-java/*/target; $S/build-arm.sh r10b > $S/r10/build-r10b.out 2>&1; echo "build exit=$?"
cp packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $J || exit 1
W=$S/r10/jarcmp; rm -rf $W/c; mkdir -p $W/c; (cd $W/c && unzip -q $J && grep -m1 Build-Jdk-Spec META-INF/MANIFEST.MF && for j in BOOT-INF/lib/*runtime-broker*.jar BOOT-INF/lib/qwencode*.jar; do mkdir -p nested/$(basename $j) && (cd nested/$(basename $j) && unzip -q -o ../../$j); done)
(cd $W/c && find BOOT-INF/classes nested -type f \( -name '*.class' -o -name '*.sql' -o -name '*.yml' -o -name '*.properties' \) ! -name 'git.properties' -exec shasum -a 256 {} + | sort -k2) > $W/c.txt
echo "jar entries $(wc -l < $W/c.txt | tr -d ' '); differing vs a6e3ea24 jar:"; diff $W/b.txt $W/c.txt | grep -E '^>' | awk '{print "  " $3}'
diff <(cd $W/b; ls BOOT-INF/lib) <(cd $W/c; ls BOOT-INF/lib) >/dev/null && echo "  lib list identical" || echo "  LIB LIST DIFFERS"
sum() { grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$|You have [0-9]+ Checkstyle|ERROR\]   [A-Za-z]|FAILURE!$' "$1" | sed -E 's/^\[(INFO|WARNING|ERROR)\] //' | tail -${2:-8}; }
# server unit suite (H2) in parallel with the jar probes
( $MVN -f packages/sdk-java/managed-agent-server/pom.xml -Dspotbugs.skip=true -Dmaven.test.failure.ignore=true test checkstyle:check > $S/r10/r10b-server-unit.log 2>&1; echo "== server unit + checkstyle exit=$?"; sum $S/r10/r10b-server-unit.log 8 ) &
UNIT=$!
for DB in mysql maria; do
  bash $S/rig/probe9h.sh $DB $J r10bh-$DB 3000 240 1000 > $O/heavy-session-r10b-$DB.txt 2>&1; echo "heavy $DB exit=$? $(grep -E '^2\.' $O/heavy-session-r10b-$DB.txt)"
  CPDIR=cp-r9m SEEDOUT=out-r9m bash $S/rig/probe9a.sh $DB $J r10ba-$DB > $O/stranded-shell-r10b-$DB.txt 2>&1; echo "stranded $DB exit=$?"
  bash $S/rig/probe9r.sh $DB $J r10br-$DB > $O/cleanup-debt-release-r10b-$DB.txt 2>&1; echo "debt $DB exit=$?"
done
wait $UNIT
$MVN -f packages/sdk-java/runtime-broker/pom.xml -Dspotbugs.skip=true test > $S/r10/r10b-broker-unit.log 2>&1; echo "== broker unit exit=$?"; sum $S/r10/r10b-broker-unit.log 2
bash $S/r10/mut.sh > $S/r10/mut.out 2>&1; echo "mutation exit=$?"
for DB in mysql maria; do
  [ $DB = mysql ] && PORT=33642 || PORT=43642
  $MVN -f packages/sdk-java/managed-agent-server/pom.xml -Pmysql-integration -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false \
    -Dit.test='ToolPublicationLockOrderMySqlIT,ManagedRuntimeRetentionRaceMySqlIT,ManagedRuntimeRetentionGuardMySqlIT,ToolPublicationRecoveryMySqlIT,WorkspaceMigrationMySqlIT,ToolPublicationAsyncVerificationMySqlIT' \
    -Dmysql.url="jdbc:mysql://127.0.0.1:$PORT/ma_r10b_$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=pr13642 \
    -Dspotbugs.skip=true verify > $S/r10/r10b-server-it-$DB.log 2>&1; echo "== server IT $DB exit=$?"; sum $S/r10/r10b-server-it-$DB.log 3
  $MVN -f packages/sdk-java/runtime-broker/pom.xml -Pmysql-integration -Dtest=BrokerValuesTest -Dit.test='JdbcRuntimeRetentionMySqlIT' \
    -Dmysql.url="jdbc:mysql://127.0.0.1:$PORT/rb_r10b_$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=pr13642 \
    -Dspotbugs.skip=true verify > $S/r10/r10b-broker-it-$DB.log 2>&1; echo "== broker retention IT $DB exit=$?"; grep -E 'Tests run:.*JdbcRuntimeRetentionMySqlIT' $S/r10/r10b-broker-it-$DB.log | sed -E 's/^\[[A-Z]+\] //; s/, Time elapsed[^-]*//'
done
echo R10B-DONE
