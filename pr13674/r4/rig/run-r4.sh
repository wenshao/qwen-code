#!/bin/bash
# usage: run-r4.sh <lane-name> "<phase> <arm> <db> [ENV=VAL ...]" ...
RIG=/Users/wenshao/pr13674-rig; L=$1; shift
for spec in "$@"; do
  set -- $spec; ph=$1; arm=$2; db=$3; shift 3
  echo "=== $(date +%T) [$L] $ph $arm $db $*"
  (cd $RIG && env "$@" node rig.mjs $ph $arm $db > $RIG/out/r4-$db-$ph.log 2>&1); rc=$?
  echo "[$L] $ph $arm $db exit=$rc $(grep -o 'SUMMARY.*' $RIG/out/r4-$db-$ph.log | tail -1)"
done
echo "=== $(date +%T) [$L] LANE-DONE"
