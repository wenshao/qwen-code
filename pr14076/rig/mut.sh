#!/bin/bash
# usage: mut.sh  — apply each mutant to the mut worktree, run the target classes, record pass/fail counts
RIG=/Users/wenshao/git/pr14076-rig; WT=/Users/wenshao/git/pr14076-mut
M=packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent
PROJ=$M/store/ManagedExtensionProjection.java; COORD=$M/service/TaskCancelCoordinator.java
TESTS='ManagedTaskCancelOperationTest,TaskCancelCoordinatorTest,ManagedExtensionRecordStoreTest,ManagedAgentApiContractTest,PlannedTaskContractTest,SurfaceAdmissionAcceptanceTest'
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:/Users/wenshao/Install/maven/bin:$PATH
run() { # name file perl-expr
  cd $WT && git checkout -q -- packages/sdk-java
  perl -0pi -e "$3" "$2"
  if git diff --quiet -- packages/sdk-java; then echo "$1 NOT-APPLIED"; return; fi
  (cd packages/sdk-java/managed-agent-server && mvn -B -q -Dmaven.repo.local=$RIG/m2 -Dcheckstyle.skip -Dspotless.check.skip=true test -Dtest="$TESTS" -Dsurefire.failIfNoSpecifiedTests=false > $RIG/mut-$1.log 2>&1)
  r=$(grep -E "Tests run: [0-9]+, Failures" $RIG/mut-$1.log | tail -1)
  f=$(grep -E "^\[ERROR\]   [A-Za-z]+(Test|IT)\.[a-zA-Z]+" $RIG/mut-$1.log | sed 's/^\[ERROR\]   //; s/:.*//' | sort -u | tr '\n' ' ')
  echo "$1 | ${r:-$(grep -m1 -E 'COMPILATION ERROR|BUILD FAILURE' $RIG/mut-$1.log)} | $f"
}
run M0-none $PROJ 's/x\Ax/x/'   # baseline marker (no change) is skipped
run M1-revert-gate $PROJ 's/"child_agent", "workflow"\);/"child_agent");/'
run M2-add-shell $PROJ 's/"child_agent", "workflow"\);/"child_agent", "workflow", "background_shell");/'
run M3-add-monitor-auto $PROJ 's/"child_agent", "workflow"\);/"child_agent", "workflow", "monitor", "automation_run");/'
run M4-delivery-kind-gate-off $COORD 's/if \(!ManagedExtensionProjection\.CANCELLABLE_TASK_KINDS\.contains\(\s*target\.kind\(\)\)\)/if (false)/'
run M5-view-kind-gate-off $PROJ 's/return CANCELLABLE_TASK_KINDS\.contains\(kind\)\s*&&/return/'
run M6-drop-degraded $PROJ 's/"pending", "running", "waiting", "degraded"\);/"pending", "running", "waiting");/'
run M7-drop-pending $PROJ 's/"pending", "running", "waiting", "degraded"\);/"running", "waiting", "degraded");/'
run M8-add-recovery-blocked $PROJ 's/"pending", "running", "waiting", "degraded"\);/"pending", "running", "waiting", "degraded", "recovery_blocked");/'
cd $WT && git checkout -q -- packages/sdk-java
