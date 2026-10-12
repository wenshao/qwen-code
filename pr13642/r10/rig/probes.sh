#!/bin/bash
# Round 10: the R9 probes on the trial-merge jar (PR 54bdbb50 + main 18f80f56), both engines, sequential (shared ports).
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
J=$S/jars/merge-r10-a6e3ea24.jar; O=$S/r10/results
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
for DB in mysql maria; do
  bash $S/rig/probe9h.sh $DB $J r10h-$DB 3000 90 1000 > $O/heavy-session-r10-$DB.txt 2>&1; echo "heavy $DB exit=$?"
  bash $S/rig/probe9r.sh $DB $J r10r-$DB > $O/cleanup-debt-release-r10-$DB.txt 2>&1; echo "debt $DB exit=$?"
  CPDIR=cp-r9m SEEDOUT=out-r9m bash $S/rig/probe9a.sh $DB $J r10a-$DB > $O/stranded-shell-r10-$DB.txt 2>&1; echo "stranded $DB exit=$?"
done
echo PROBES-DONE
