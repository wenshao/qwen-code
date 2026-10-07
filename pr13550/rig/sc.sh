#!/bin/bash
# usage: sc.sh <db> <label> <waitSec> <prompt...>  — create a parent, wait for its first Turn, dump DB evidence
DB="$1"; L="$2"; W="$3"; shift 3; cd /Users/wenshao/git/pr13550-rig
SID=$(node client.mjs "$DB" create "$*" | sed -n 's/^{"status":202,"json":{"id":"\([0-9a-f-]*\)".*/\1/p')
[ -n "$SID" ] || { echo "create failed"; exit 1; }
echo "$SID" > runs/$DB/$L.sid; echo "== $L parent=$SID start=$(date -u +%T)"
node client.mjs "$DB" wait "$SID" "$W" | grep -E 'TERMINAL|TIMEOUT|output_text|turn\.(completed|failed)' | cut -c1-260
echo "== end=$(date -u +%T)"
