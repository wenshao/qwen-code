#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/83b94b04-5287-4c5b-88f4-0baa57846046/scratchpad
F="-Phosted-workspace-tools"
T="-Dtest=NoUnitTests -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=HostedWorkspaceToolTurnIT#sessionStoreFailuresNeverReplayEffectsOnMySql verify"
for i in 1 2 3 4 5; do $SP/rig/it.sh rep-mysql847-$i mysql hosted-workspace-tools $T | grep -E "^label|Tests run:.*Hosted"; done
for i in 1 2 3; do $SP/rig/it.sh rep-mariadb-$i mariadb hosted-workspace-tools $T | grep -E "^label|Tests run:.*Hosted"; done
for i in 1 2; do $SP/rig/it.sh rep-mysql8411-$i mysqlci hosted-workspace-tools $T | grep -E "^label|Tests run:.*Hosted"; done
