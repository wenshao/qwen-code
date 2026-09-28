#!/bin/bash
# usage: unit-mut.sh <mutant>  -- run the 170 managed-agent-server unit tests against one mutant in wt-unit
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9a095a26-d8c9-4266-9a4d-4dda027df21c/scratchpad
N=$1
node $SP/rig/mutants.cjs apply $N wt-unit > /dev/null || exit 2
WT=wt-unit $SP/rig/it.sh unit-$N mysql hosted-workspace-tools clean test > /dev/null 2>&1
RC=$?
node $SP/rig/mutants.cjs restore $N wt-unit
L=$SP/logs/it-unit-$N.log
echo "unit $N exit=$RC $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $L | tail -1 | sed 's/\[[A-Z]*\] //') failing: $(grep -E '^\[ERROR\]   [A-Za-z]' $L | head -4 | tr '\n' ';' | cut -c1-400)" | tee -a $SP/results/unit-mutants.txt
