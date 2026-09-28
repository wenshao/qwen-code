#!/bin/bash
SP=$RIG
export PATH=$NODE22_BIN:$PATH
for m in "$@"; do
  f=$SP/rig/mut/$m.ts
  $SP/rig/rebundle.sh $f > /dev/null || { echo "$m rebundle failed"; continue; }
  $SP/rig/it.sh mut-$m mysql hosted-workspace-tools verify -Dtest=NoUnitTests -Dsurefire.failIfNoSpecifiedTests=false -Dit.test='HostedWorkspaceToolTurnIT#lostBrokerRepliesNeverReplayEffectsOnMySql' > /dev/null
  IT=$?
  WHY=$(grep -oE "^FG6A [a-z-]+ \[|fault did not fire|[a-z-]+: fault did not fire|Driver timeout|expected: [^,]{0,40}|true !== false|false !== true|[0-9]+ !== [0-9]+|'[a-z]*' !== '[a-z]*'|driver.ts:[0-9]+" $SP/logs/it-mut-$m.log | sort -u | head -4 | tr '\n' ' ')
  LAST=$(grep -oE "^FG6A [a-z-]+:" $SP/logs/it-mut-$m.log | tail -1)
  (cd $SP/wt-pr/packages/cli && npx vitest run src/serve/hosted-workspace-broker.test.ts > $SP/logs/unit-mut-$m.log 2>&1); UT=$?
  UF=$(grep -oE "Tests  .*" $SP/logs/unit-mut-$m.log | head -1)
  echo "$m | gate=$([ $IT = 0 ] && echo SURVIVED || echo KILLED) lastPassed='$LAST' why='$WHY' | unit=$([ $UT = 0 ] && echo SURVIVED || echo KILLED) ($UF)"
done
$SP/rig/rebundle.sh $SP/rig/broker.pr.ts
