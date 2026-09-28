#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/a3d8cbe6-83a8-459a-99a4-f6d43fbc9c27/scratchpad
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
cd $SP/wt-r13
export ARM=r13 DB=p848n ROOTS=roots13
echo "### partial capture (a..d)"; LETTERS=a,b,c,d $N --import tsx integration-tests/probe-s29-partial-capture.ts 2>&1 | grep '^\['
echo "### workspace after partial brick (a,b,c bricked? d=plain control)"; LETTERS=a,b,c,d $N --import tsx ../rig/s28-workspace-after-brick.ts 2>&1 | grep '^\['
echo "### minimal background (e..h)"; MINIMAL=1 TAG=r13-min LETTERS=e,f,g,h $N --import tsx ../rig/s23-background-ab.ts 2>&1 | grep '^\['
echo "### validation"; ST=i $N --import tsx ../rig/s22-validation.ts 2>&1 | grep '^\['
echo "### grandchild"; MODE=grandchild ST=j $N --import tsx ../rig/s19-review-criticals.ts 2>&1 | grep '^\['
echo "### reload"; VARIANT=shell-reload ST=k $N --import tsx ../rig/s15-reload-shell.ts 2>&1 | grep '^\[' | grep -v 'broker\] \(POST\|GET\)'
echo "### sweep"; MODE=sweep ST=l ROUNDS=1 $N --import tsx ../rig/s19-review-criticals.ts 2>&1 | grep '^\['
echo "### real reload"; ST=m $N ../rig/s16-real-reload.mjs 2>&1 | grep '^\['
echo BATCH_DONE
