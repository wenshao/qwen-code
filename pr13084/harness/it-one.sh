#!/bin/bash
# usage: [TZ=..] it-one.sh <worktree> <ITClass> <m2>  -- one failsafe class on the gate mysqld (unit tests skipped)
W=$1; C=$2; export M2=$3
cd $W/packages/sdk-java/managed-agent-server
/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/e46b98ed-673c-4dc9-a786-247efff94c81/scratchpad/rig/mvn.sh -o -Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:23184/it_one_$(date +%s)?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=gate13084 -Dtest=none -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=$C -Dfailsafe.failIfNoSpecifiedTests=false verify 2>&1 | grep -E "Tests run:|BUILD|expected:|but was:" | head -8
