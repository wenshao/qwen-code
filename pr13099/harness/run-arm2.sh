#!/bin/bash
# VERIFICATION RIG ONLY: arm 2 real-stack run (main 3a8fd117 + PR 697d38a3, DB rig2).
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/c7d2ab96-3862-4fe9-966f-d80da045ac10/scratchpad
R=$S/rig; export DB=rig2
NODE=/Users/wenshao/.local/share/fnm/node-versions/v24.18.1/installation/bin/node
cd $R
echo "# $(date -u +%FT%TZ) merge=$(git -C $S/wt-merge rev-parse HEAD) jar=$(shasum -a 256 $S/jars/merge2-server.jar | cut -c1-16)"
: > $S/logs/spring-rig2.log; : > $S/logs/harness-rig2.log
$R/start.sh rig2 model tap spring harness || exit 1
$NODE smoke.mjs ctl 2>&1 | cut -c1-600
for s in r1 r2 r4 r3 r6a r6b r6c r6e r6d r5; do
  echo "################ $s $(date -u +%T)"
  $NODE scenarios.mjs $s > $S/logs/arm2-$s.out 2>&1; echo "rc=$?"
  grep -E "^(turn|contender|turnAfterReactivation|turnWhileRefused|RESULT|Error)" $S/logs/arm2-$s.out | cut -c1-330
done
echo "ARM2_DONE $(date -u +%FT%TZ)"
