#!/bin/bash
# run.sh <tree> <run-dir> <scenario-file.ts> [name]   (log: <run-dir>/<name>.log)
set -uo pipefail
TREE=$1; RUN=$2; SCEN=$3
S=$(cd "$(dirname "$0")/.." && pwd)
NODE22=$HOME/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
cp "$S/rig/lib.ts" "$TREE/integration-tests/helpers/rig12946-lib.ts"
BASE=$(basename "$SCEN" .ts)
NAME=${4:-$BASE}
cp "$S/rig/$SCEN" "$TREE/integration-tests/helpers/rig12946-$BASE.ts"
cd "$TREE" && RIG_NAME=$NAME RIG_DIR=$S/rig RIG_RUN=$RUN $NODE22 --import tsx "integration-tests/helpers/rig12946-$BASE.ts" 2>&1 | tee "$RUN/$NAME.log"
