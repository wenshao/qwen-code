#!/bin/bash
# run.sh <tree> <run-dir> <scenario-file.ts>
set -uo pipefail
TREE=$1; RUN=$2; SCEN=$3
S=$(cd "$(dirname "$0")/.." && pwd)
NODE22=$HOME/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
cp "$S/rig/lib.ts" "$TREE/integration-tests/helpers/rig12946-lib.ts"
NAME=$(basename "$SCEN" .ts)
cp "$S/rig/$SCEN" "$TREE/integration-tests/helpers/rig12946-$NAME.ts"
cd "$TREE" && RIG_DIR=$S/rig RIG_RUN=$RUN $NODE22 --import tsx "integration-tests/helpers/rig12946-$NAME.ts" 2>&1 | tee "$RUN/$NAME.log"
