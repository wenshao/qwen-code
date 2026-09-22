#!/bin/bash
# acp-bridge + web-shell mutants in the main worktree. sed -i writes a new inode, restore via cp --remove-destination,
# so the hardlinked Session.ts mutant copies are never touched.
WT=/root/verify/pr12404-r2; M=/root/verify/pr12404-mut; cd $WT
TR=packages/acp-bridge/src/transcript-replay.ts; BT=packages/acp-bridge/src/bridgeTypes.ts; CT=packages/web-shell/client/utils/composerTag.ts
mkdir -p $M/orig; for f in $TR $BT $CT; do cp $f $M/orig/$(basename $f); done
run_acp() { (cd packages/acp-bridge && npx vitest run src/transcript-replay.test.ts src/session-control-plane.test.ts --coverage.enabled=false 2>&1 | command grep -E "Tests |Test Files" | tr '\n' ' '); }
run_ws() { (cd packages/web-shell && npx vitest run client/utils/composerTag.test.ts client/components/messages/UserMessage.test.tsx client/adapters/transcriptToMessages.test.ts --coverage.enabled=false 2>&1 | command grep -E "Tests |Test Files" | tr '\n' ' '); }
mut() { # id file sed-expr runner
  sed -i "$3" "$2"; local d; d=$(diff $M/orig/$(basename $2) $2 | head -4 | tr '\n' ' ')
  echo "$1 [$d] => $($4)"; cp --remove-destination $M/orig/$(basename $2) $2
}
echo "R0 control => $(run_acp)"
mut R1 $TR 's/savedInputAnnotationList.filter(isObjectRecord);/savedInputAnnotationList.filter(() => true);/' run_acp
mut R2 $TR 's/\.\.\.(replayedInputAnnotations.length > 0/...(Array.isArray(savedInputAnnotations)/' run_acp
mut R3 $TR "s/savedInputAnnotationList.filter(isObjectRecord);/savedInputAnnotationList.filter((a) => typeof a === 'object' \&\& a !== null);/" run_acp
mut R4 $BT "s/export const DAEMON_INPUT_ANNOTATIONS_META_KEY = 'inputAnnotations';/export const DAEMON_INPUT_ANNOTATIONS_META_KEY = 'inputAnnotationsX';/" run_acp
echo "W0 control => $(run_ws)"
mut W1 $CT "s/if (!annotation || annotation.type !== 'reference') continue;/if (annotation.type !== 'reference') continue;/" run_ws
for f in $TR $BT $CT; do cmp -s $M/orig/$(basename $f) $f && echo "restored $f"; done
git status --porcelain | command grep -v '^?? .arm-' | wc -l
