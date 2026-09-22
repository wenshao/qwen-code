#!/bin/bash
# run-one.sh <arm> <port> <scenario>  — one driver run with its own ledger slice
R=/root/pr12279; ARM=$1; PORT=$2; SC=$3
OUT=$R/out/$ARM-$SC; rm -rf "$OUT"; mkdir -p "$OUT"
L0=$(wc -l < $R/logs/model-ledger.jsonl)
timeout 240 node $R/drive.mjs "$ARM" "$PORT" "$SC" "$OUT" > "$OUT/driver.log" 2>&1
echo "exit=$?" >> "$OUT/driver.log"
tail -n +$((L0+1)) $R/logs/model-ledger.jsonl > "$OUT/ledger.jsonl"
grep '"kind":"final"' "$OUT/driver.log" | cut -c1-700
