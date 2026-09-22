#!/bin/bash
# named FIFO carries data through the relay copy path, host fifo unchanged
ART=/root/git/qwen-code-verify/tmp/pr12267-verify-20260922-164444
ARM=$1
cd "$ART/scratch"
rm -f hostdir/data.fifo; mkfifo hostdir/data.fifo
( printf 'fifo-payload-line\n' > hostdir/data.fifo ) &
out=$(timeout -k 2 30 "$ART/harness-r7/q.sh" $ARM ww-closed sandbox -- cat < hostdir/data.fifo 2>/dev/null)
wait
echo "fifo-data: out=$out mode=$(stat -c %a hostdir/data.fifo)"
