#!/bin/bash
# VERIFICATION RIG ONLY: arm 2 = main 3a8fd117 + PR head 697d38a3.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/c7d2ab96-3862-4fe9-966f-d80da045ac10/scratchpad
bash $S/build-java.sh wt-merge merge2
export ARM=arm2 RESTORE=pr2
rm -f $S/mut/results-arm2-*.jsonl.txt
bash $S/mut/run-matrix.sh "pr2 base2" "M0 M1 M2 M3 M4 M5 M6 M7 M8 M9" coord
bash $S/mut/run-matrix.sh "pr2" "M0" full
echo JAVA_ARM2_DONE
