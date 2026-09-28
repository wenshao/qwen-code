#!/bin/bash
# usage: mutate.sh <ID...>  -- apply bundle mutant in wt-mut, run latency IT on MySQL, restore
SP=${SP:?set SP to the scratch directory}
export PATH=$HOME/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
for ID in "$@"; do
  CHUNK=server-FG4P3XYK.js ORIG_PREFIX=bccf- MUTANTS=./mutants-new.cjs node $SP/rig/apply-mutant.cjs $SP/wt-mut $ID || continue
  grep -c "__pr12945_mutant" $SP/wt-mut/dist/chunks/server-FG4P3XYK.js | sed "s/^/  marker count: /"
  M2=m2-bccf WT=wt-mut $SP/rig/lat.sh ${PFX:-b}-$ID mysql
  RC=$?
  echo "RESULT $ID exit=$RC -> $([ $RC = 0 ] && echo SURVIVED || echo KILLED)"
  grep -h -o -E "(AssertionError[^\"]{0,160}|Broker use must wait[^\"]{0,40}|one warm request[^\"]{0,40}|one acquisition and execution|exactly one continuation|Timed out[^\"]{0,80}|waitUntil[^\"]{0,80}|turn_error[^\"]{0,120}|Expected values to be strictly deep-equal[^\"]{0,60}|The expression evaluated to a falsy value[^\"]{0,120})" $SP/logs/it-lat-${PFX:-b}-$ID.log | sort | uniq -c | head -6
done
CHUNK=server-FG4P3XYK.js ORIG_PREFIX=bccf- MUTANTS=./mutants-new.cjs node $SP/rig/apply-mutant.cjs $SP/wt-mut none
cmp $SP/wt-mut/dist/chunks/server-FG4P3XYK.js $SP/rig/orig/bccf-server-FG4P3XYK.js && echo "restored pristine chunk"
