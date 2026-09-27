#!/bin/bash
# runs inside the Linux container; sequential Linux suites at the PR head
/rig/suite.sh u-broker runtime-broker test 2>&1 | sed 's/^/[u-broker] /'
/rig/suite.sh g-broker runtime-broker test -Pfault-gates -Dqwen.cli.entry=/rig/src/dist/cli.js 2>&1 | sed 's/^/[g-broker] /'
/rig/suite.sh u-server managed-agent-server test 2>&1 | sed 's/^/[u-server] /'
/rig/suite.sh it-recovery managed-agent-server verify -Phosted-harness-mysql -Dtest=NoSuchUnit -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=WorkspaceRecoveryWorkerIT -Dqwen.runtime.worker.bundle=/rig/src/dist/cli.js -Dcheckstyle.skip=true 2>&1 | sed 's/^/[it-recovery] /'
echo ALL-DONE
