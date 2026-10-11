#!/bin/bash
set -u
R=/Users/wenshao/pr13219-rig; C=$R/src-cand
J=packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent
for M in n6 n13; do
  git -C $C checkout -- .
  if [ $M = n6 ]; then
    node -e 'const fs=require("fs");const f=process.argv[1];let s=fs.readFileSync(f,"utf8");const a="current.consecutiveFailures() - current.budgetExemptFailures();";if(s.split(a).length!==2)throw new Error("anchor");fs.writeFileSync(f,s.replace(a,"current.consecutiveFailures();"))' $C/$J/service/HarnessCoordinator.java
  else
    node -e 'const fs=require("fs");const f=process.argv[1];let s=fs.readFileSync(f,"utf8");const a="        return jdbc.update(\"UPDATE managed_agent_turn SET\"\n                        + \" harness_event_epoch = ?,\"\n                        + \" harness_last_event_id = ?, consecutive_failures = 0,\"";if(s.split(a).length!==2)throw new Error("anchor");fs.writeFileSync(f,s.replace(a,"        return jdbc.update(\"UPDATE managed_agent_turn SET\"\n                        + \" harness_event_epoch = ?,\"\n                        + \" harness_last_event_id = ?,\""))' $C/$J/store/ManagedAgentStore.java
  fi
  git -C $C diff --stat | tail -1
  $R/build-jar.sh cand > $R/out/jar-cand-$M.all.log 2>&1
  tail -1 $R/out/jar-cand.log
  cp $R/server/cand-server.jar $R/server/cand-$M-server.jar
done
git -C $C checkout -- .
echo MUTANT-JARS-DONE
