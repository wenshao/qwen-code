#!/bin/bash
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b690e0a7-ea85-4f4c-a5cb-402948583da3/scratchpad
export JAVA_HOME=~/Install/jdk21
W=~/git/qwen-code-pr13894-mut/packages/sdk-java/managed-agent-server
mkdir -p $S/results/mut
for m in M0-none $(python3 $S/rig/mutants.py list); do
  if [ "$m" = M0-none ]; then python3 $S/rig/mutants.py revert; else python3 $S/rig/mutants.py $m || exit 2; fi
  (cd $W && rm -rf target/surefire-reports && mvn -o -B -Dmaven.repo.local=$S/m2 -Dcheckstyle.skip -Dspotbugs.skip=true -Djacoco.skip=true \
    -Dmaven.test.failure.ignore=true test \
    -Dtest='ToolPublicationStoreTest,ToolPublicationLifecycleMySqlIT,ToolPublicationLockOrderMySqlIT,PublicationLockOrderVerifyProbeTest' \
    -Dsurefire.failIfNoSpecifiedTests=false "-Dmysql.url=jdbc:mysql://127.0.0.1:23895/mysql?allowPublicKeyRetrieval=true&useSSL=false" \
    -Dmysql.user=rig -Dmysql.password=rig -Dprobe.arm=$m -Dprobe.out=$S/results/mutants.jsonl -Dprobe.reps=1 \
    -Dprobe.scenarios=commit-ambient,prepare-commit-ambient,commit-standalone,prepare-standalone,apply-renew-ambient,apply-renew-standalone \
    > $S/results/mut/$m.log 2>&1; rm -rf $S/results/mut/$m-reports; cp -R target/surefire-reports $S/results/mut/$m-reports)
  echo "$m done: $(grep -E '^\[(INFO|ERROR|WARNING)\] Tests run:' $S/results/mut/$m.log | tail -1)"
done
python3 $S/rig/mutants.py revert
git -C ~/git/qwen-code-pr13894-mut status --porcelain
