#!/bin/bash
# Scenario matrix. usage: matrix.sh <variant> [tag]
set -u
V="$1"; TAG="${2:-}"
RIG="$(cd "$(dirname "$0")" && pwd)"
run() { # run <scenario> <env...>
  local s="$1"; shift
  echo "=== $V $s $*"
  "$RIG/run-one.sh" "$V" "$s" "$@" > "$RIG/out/log-$V$TAG-$s.txt" 2>&1
  echo "   -> $(grep -c 'card CREATE' "$RIG/out/log-$V$TAG-$s.txt") creates"
  [ -f "$RIG/out/$V-$s.json" ] && mv "$RIG/out/$V-$s.json" "$RIG/out/$V$TAG-$s.json"
}
export -f run 2>/dev/null || true

P='APPROVAL_MODE=default'

run zh-allow-once        LANGUAGE=Chinese $P CONV_TYPE=1 TOOL=shell &
run en-allow-once        LANGUAGE=en      $P CONV_TYPE=1 TOOL=shell &
run zh-deny              LANGUAGE=Chinese $P CONV_TYPE=1 TOOL=shell &
wait
run en-deny              LANGUAGE=en      $P CONV_TYPE=1 TOOL=shell &
run allow-always-shell   LANGUAGE=en      $P CONV_TYPE=1 TOOL=shell &
run allow-always-write   LANGUAGE=Chinese $P CONV_TYPE=1 TOOL=write &
wait
run cancel               LANGUAGE=en      $P CONV_TYPE=1 TOOL=shell &
run timeout              LANGUAGE=en      $P CONV_TYPE=1 TOOL=shell PERM_TIMEOUT_MS=6000 &
run run-cancel           LANGUAGE=en      $P CONV_TYPE=1 TOOL=shell &
wait
run foreign-actor        LANGUAGE=en      $P CONV_TYPE=2 SESSION_SCOPE=single TOOL=shell &
run foreign-text-approve LANGUAGE=en      $P CONV_TYPE=2 SESSION_SCOPE=single TOOL=shell &
run owner-text-approve   LANGUAGE=en      $P CONV_TYPE=1 TOOL=shell &
wait
run card-disabled        LANGUAGE=en      $P CONV_TYPE=1 TOOL=shell PERM_CARD=false &
run delivery-failure     LANGUAGE=en      $P CONV_TYPE=1 TOOL=shell &
run question-card        LANGUAGE=en      $P CONV_TYPE=1 TOOL=ask &
wait
run text-foreign-approve LANGUAGE=en      $P CONV_TYPE=2 SESSION_SCOPE=single TOOL=shell PERM_CARD=false &
wait
echo "matrix done"
