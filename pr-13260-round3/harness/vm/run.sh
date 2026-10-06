#!/bin/bash
# inside VM: reset a scenario DB and run one scenario script.  usage: run.sh <db> <script.mjs> [KEY=VALUE for the env file ...]
# STORAGES is passed as STORAGES=a,b,c (commas) and written quoted.
set -u
DB=$1; SCRIPT=$2; shift 2
ARGS=()
for a in "$@"; do case "$a" in STORAGES=*) v=${a#STORAGES=}; ARGS+=("STORAGES=\"${v//,/ }\"");; *) ARGS+=("$a");; esac; done
cd /root/verify/pr13260/rig/vm
bash reset.sh $DB "${ARGS[@]}"
export DB OUT=/root/verify/pr13260/rig/out/e2e
exec /usr/bin/node $SCRIPT
