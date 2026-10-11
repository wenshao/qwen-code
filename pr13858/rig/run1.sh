#!/bin/bash
# usage: run1.sh <db> <mode> <id> <spec> [timeoutLoops]  — one parent Session, one launch, evidence dump
DB=$1; MODE=$2; ID=$3; SPEC=$4; source ./lib.sh
P=$(newp "PARENT::$MODE::$ID::$SPEC Run the workflow."); echo "== $MODE/$SPEC id=$ID parent $P"
echo "   final: $(waitterm $P ${5:-90})"
kids $P; turns $P; ledger $P
msgs $P 900 | grep -E "RESULT|model text" | cut -c1-900
