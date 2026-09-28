#!/bin/bash
# usage: rebundle.sh <variant.ts> [target-src-file]
SP=$RIG
TARGET=${2:-packages/cli/src/serve/hosted-workspace-broker.ts}
cd $SP/wt-pr
export PATH=$NODE22_BIN:$PATH
cp "$1" "$TARGET"
S=$(date +%s)
node esbuild.config.js > $SP/logs/rebundle.log 2>&1 && node scripts/copy_bundle_assets.js >> $SP/logs/rebundle.log 2>&1
RC=$?
echo "rebundle $(basename $1) -> $TARGET rc=$RC $(($(date +%s)-S))s"
exit $RC
