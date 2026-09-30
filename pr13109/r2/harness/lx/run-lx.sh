#!/bin/bash
# run-lx.sh <arm-classes> <cli-arm> <db> <driver> <name> [ENV=VAL...]   (executed on the host)
CLS=$1; CLI=$2; DB=$3; DRV=$4; NAME=$5; shift 5
RUN=/rig/run-$CLI
docker exec -e RIG_RUN=$RUN -e RIG_NAME=$NAME -e RIG_HARNESS_CLI=/rig/$CLI/dist/cli.js -e ARM=$CLI-linux \
  -e R8_RESPRING="kill -9 \$(cat $RUN/spring.pid); sleep 1; bash /rig/spring-lx.sh $CLS $CLI $DB $RUN true" \
  $(for kv in "$@"; do printf -- '-e %s ' "$kv"; done) \
  pr13109-lx sh -c "cd $RUN && node /rig/drivers/$DRV.mjs > $RUN/$NAME.log 2>&1; grep '^RESULT' $RUN/$NAME.log | tail -1; grep -c . $RUN/$NAME.log"
