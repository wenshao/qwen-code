#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/a3d8cbe6-83a8-459a-99a4-f6d43fbc9c27/scratchpad
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
cd $SP/wt-r8
export ARM=r8 DB=p848h ROOTS=roots8
echo "### validation"; ST=a $N --import tsx ../rig/s22-validation.ts 2>&1 | grep '^\['
echo "### grandchild"; MODE=grandchild ST=b $N --import tsx ../rig/s19-review-criticals.ts 2>&1 | grep '^\['
echo "### logger"; MODE=logger ST=c $N --import tsx ../rig/s19-review-criticals.ts 2>&1 | grep '^\['
echo "### minimal background"; MINIMAL=1 TAG=r8-min LETTERS=d,e,f,g $N --import tsx ../rig/s23-background-ab.ts 2>&1 | grep '^\['
echo "### reload"; VARIANT=shell-reload ST=h $N --import tsx ../rig/s15-reload-shell.ts 2>&1 | grep '^\['
echo "### sweep"; MODE=sweep ST=i ROUNDS=1 $N --import tsx ../rig/s19-review-criticals.ts 2>&1 | grep '^\['
echo BATCH_DONE
