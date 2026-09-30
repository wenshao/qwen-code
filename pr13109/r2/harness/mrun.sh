#!/bin/bash
# mrun.sh <name> <driver> <arm> [ENV=VAL...]  -- run a bundled scenario on .98 against the .54 instances
NAME=$1; DRV=$2; ARM=$3; shift 3
S=$(cd "$(dirname "$0")/.." && pwd)
ssh -o BatchMode=yes cici@192.168.0.98 "cd ~/pr13109-rig/run-x && env NO_PROXY=192.168.0.54,localhost,127.0.0.1 no_proxy=192.168.0.54,localhost,127.0.0.1 RIG_RUN=\$HOME/pr13109-rig/run-x RIG_NAME=$NAME RIG_HARNESS_CLI=\$HOME/pr13109-rig/$ARM/dist/cli.js ARM=$ARM $* \$HOME/.nvm/versions/node/v22.23.1/bin/node ../drivers/$DRV.mjs > $NAME.log 2>&1; grep '^RESULT' $NAME.log | tail -1" > $S/runs/multi/$NAME.log
echo "$NAME: $(wc -c < $S/runs/multi/$NAME.log) bytes"
