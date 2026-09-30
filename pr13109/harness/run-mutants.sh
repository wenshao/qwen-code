#!/bin/bash
# run-mutants.sh <mut-tree> <orig-tree> <out-dir> [ids...]   (id "BASE" = unmutated)
set -uo pipefail
TREE=$1; ORIG=$2; OUT=$3; shift 3
S=$(cd "$(dirname "$0")/.." && pwd)
export PATH=$HOME/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
export JAVA_HOME=/opt/homebrew/opt/openjdk@25
mkdir -p "$OUT"
cli() { (cd "$TREE/packages/cli" && npx vitest run src/serve/hosted-mcp-session.test.ts src/serve/managed-mcp-runtime.test.ts --reporter=json --outputFile="$OUT/$1.cli.json" > "$OUT/$1.cli.log" 2>&1); node "$S/rig/vitest-summary.cjs" "$OUT/$1.cli.json"; }
core() { (cd "$TREE/packages/core" && npx vitest run src/managed-runtime/managed-mcp-record.test.ts src/managed-runtime/managed-session-authority.mcp.test.ts src/managed-runtime/http-managed-session-store.test.ts --reporter=json --outputFile="$OUT/$1.core.json" > "$OUT/$1.core.log" 2>&1); node "$S/rig/vitest-summary.cjs" "$OUT/$1.core.json"; }
java() { (cd "$TREE/packages/sdk-java/managed-agent-server" && mvn -o -B -Dgpg.skip -Dmaven.repo.local=$S/m2 test -Dtest='ManagedMcpRecordContractTest,ManagedExtensionRecordStoreTest,ManagedMcpCatalogServiceTest' -Dsurefire.failIfNoSpecifiedTests=false > "$OUT/$1.java.log" 2>&1); grep -E "Tests run:.*Fail|ERROR\].*(Test|expected)|BUILD" "$OUT/$1.java.log" | grep -v "^\[INFO\] Tests run:.*Time elapsed" | head -12 | tr '\n' ' '; echo; }
for ID in "$@"; do
  if [ "$ID" = BASE ] || [[ "$ID" = BASE* ]]; then node "$S/rig/mutate.cjs" "$TREE" "$ORIG" restore; SUITE=all
  else node "$S/rig/mutate.cjs" "$TREE" "$ORIG" "$ID" || { echo "$ID APPLY_FAILED" >> "$OUT/results.txt"; continue; }
    SUITE=$(node -e "console.log(require('$S/rig/mutants.cjs').find(m=>m.id==='$ID').suite)"); fi
  case $SUITE in
    cli)  echo "$ID cli  $(cli $ID)" >> "$OUT/results.txt";;
    core) echo "$ID core $(core $ID)" >> "$OUT/results.txt"; echo "$ID cli  $(cli $ID)" >> "$OUT/results.txt";;
    java) echo "$ID java $(java $ID)" >> "$OUT/results.txt";;
    all)  echo "$ID core $(core $ID)" >> "$OUT/results.txt"; echo "$ID cli  $(cli $ID)" >> "$OUT/results.txt"; echo "$ID java $(java $ID)" >> "$OUT/results.txt";;
  esac
done
node "$S/rig/mutate.cjs" "$TREE" "$ORIG" restore
echo MUTANTS_DONE >> "$OUT/results.txt"
