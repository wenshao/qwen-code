#!/bin/bash
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
export BASEJAR=$S/jars/main-r8-da224e61.jar HEADJAR=$S/jars/merge-r8-8b72c287.jar CPDIR=cp-r8 SEEDOUT=out-r8
for DB in mysql maria; do $S/rig/e2e7.sh $DB e2e_r8_$DB r8-$DB > $S/r8/e2e-$DB.txt 2>&1; echo "e2e $DB exit=$?"; done
echo E2E-DONE
