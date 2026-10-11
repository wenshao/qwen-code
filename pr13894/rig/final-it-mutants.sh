#!/bin/bash
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b690e0a7-ea85-4f4c-a5cb-402948583da3/scratchpad
export JAVA_HOME=~/Install/jdk21
W=~/git/qwen-code-pr13894-mut/packages/sdk-java/managed-agent-server
mkdir -p $S/results/it-final
for m in M1-receipt-no-staged-placement M2-prepare-no-staged-placement M4-apply-retention-first M5-receipt-tx-retention-first M6-prepare-tx-retention-first; do
  python3 $S/rig/mutants.py $m > /dev/null || exit 2
  (cd $W && rm -rf target/surefire-reports && mvn -o -B -Dmaven.repo.local=$S/m2 -Dcheckstyle.skip -Dspotbugs.skip=true -Djacoco.skip=true -Dmaven.test.failure.ignore=true test \
    -Dtest='ToolPublicationLockOrderMySqlIT,ToolPublicationLifecycleMySqlIT' -Dsurefire.failIfNoSpecifiedTests=false \
    "-Dmysql.url=jdbc:mysql://127.0.0.1:23895/mysql?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=rig -Dmysql.password=rig > $S/results/it-final/$m.log 2>&1
   rm -rf $S/results/it-final/$m-reports; cp -R target/surefire-reports $S/results/it-final/$m-reports)
  echo "$m: $(grep -E '^\[(INFO|ERROR|WARNING)\] Tests run:' $S/results/it-final/$m.log | tail -1)"
done
python3 $S/rig/mutants.py revert
git -C ~/git/qwen-code-pr13894-mut status --porcelain | grep -v '^??'
echo all-done
