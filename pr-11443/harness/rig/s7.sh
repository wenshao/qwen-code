#!/usr/bin/env bash
# s7.sh <tree> — call hierarchy through the real CLI + real tsserver: the model echoes the prepared
# item; after a disk edit shifts the functions, the old item is reused, then re-prepared.
set -u
R=/root/git/pr11443-e2e; TREE=$1
WS=$R/ws-s7-$TREE; rm -rf $WS; mkdir -p $WS/src
cp $R/ws-ts/tsconfig.json $R/ws-ts/.lsp.json $WS/
cat > $WS/src/calls.ts <<'TS'
export function callee(): number {
  return 1;
}
export function caller(): number {
  return callee();
}
TS
SHIFT="node /root/git/pr11443-e2e/rig/shift.mjs src/calls.ts"
cat > $R/out/s7-$TREE.prompt <<P
call hierarchy freshness
@@tool lsp {"operation":"prepareCallHierarchy","filePath":"src/calls.ts","line":1,"character":17}
@@tool lsp {"operation":"incomingCalls","callHierarchyItem":"ITEM_FROM_1"}
@@tool run_shell_command {"command":"$SHIFT","description":"insert two comment lines at the top"}
@@tool lsp {"operation":"incomingCalls","callHierarchyItem":"ITEM_FROM_1"}
@@tool lsp {"operation":"prepareCallHierarchy","filePath":"src/calls.ts","line":3,"character":17}
@@tool lsp {"operation":"incomingCalls","callHierarchyItem":"ITEM_FROM_5"}
P
$R/rig/run.sh $TREE $WS s7-$TREE $R/out/s7-$TREE.prompt
jq -r '.[] | select(.type=="result") | .result' $R/out/s7-$TREE.json | awk '/^\[[0-9]+\] /{p=1} /\(JSON\)/{p=0} p' | grep -vE '^(Directory|Error|Exit Code|Signal|Process Group|Output)' | grep -v '^\s*$'
echo "--- file after edit:"; cat -n $WS/src/calls.ts | head -4
