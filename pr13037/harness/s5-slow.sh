#!/bin/bash
# s5-slow: a 2 MiB/s client downloads the 1 GiB output under the default 2-minute read budget.
R=$(cd $(dirname $0); pwd); cd $R; LOG=$R/out/${OUT:-s5-slow}.log; : > $LOG
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
read -r SID AID REV BYTES < <($N -e "const r=require('./out/s5-gib.json');console.log(r.session, r.stdout.id, r.stdout.revision, r.stdout.bytes)")
[ ${#REV} -eq 64 ] || { echo "bad artifact"; exit 2; }
URL="http://127.0.0.1:18037/v1/agents/sessions/$SID/artifacts/$AID/content?revision=$REV"
curl -s --limit-rate ${RATE:-2M} -o run/slow-body -w "status=%{http_code} declared=%header{content-length} received=%{size_download} seconds=%{time_total} curl_exit=%{exitcode}\n" -H "X-Qwen-Tenant-Id: t-o3" -H "X-Rig-Actor: alice" "$URL" | tee -a $LOG
SZ=$(stat -f %z run/slow-body); echo "file bytes=$SZ of $BYTES" | tee -a $LOG
if $N gen.mjs gib 1073741824 0 0 2>/dev/null | head -c $SZ | cmp -s - run/slow-body; then echo "received bytes are an exact prefix" | tee -a $LOG; else echo "PREFIX MISMATCH" | tee -a $LOG; fi
echo "error text in the last 200 bytes: $(tail -c 200 run/slow-body | LC_ALL=C /usr/bin/grep -c 'error')" | tee -a $LOG
rm -f run/slow-body
/usr/bin/grep "artifact_read" $R/../logs/spring-${ARM:-pr}-${DB:-o3c}.log | tail -1 | sed 's/.*artifact_read/server audit: artifact_read/' | cut -c1-260 | tee -a $LOG
