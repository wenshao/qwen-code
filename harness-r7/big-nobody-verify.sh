#!/bin/bash
V=/root/verify/r7
echo "########## 3GiB copied stream (byte-exact + bounded RSS)"
cd $V
[ -f big3g.bin ] || truncate -s 3G big3g.bin
$V/q.sh A ww-closed sandbox -- wc -c < big3g.bin 2>/dev/null > /tmp/3g.out &
CLIPID=$!; peak=0
while kill -0 $CLIPID 2>/dev/null; do
  tree=$(pgrep -g $(ps -o pgid= -p $CLIPID | tr -d ' ') 2>/dev/null)
  rss=$(ps -o rss= -p $CLIPID $tree 2>/dev/null | awk '{s+=$1} END{print s+0}')
  [ "$rss" -gt "$peak" ] 2>/dev/null && peak=$rss
  sleep 0.15
done
wait $CLIPID; echo "3GiB wc -c output: $(cat /tmp/3g.out) (expect 3221225472); peak RSS cli+tree ~ ${peak} kB"
echo "########## nobody (uid 65534) escape"
bash $V/mknobodyhome.sh
echo "-- arm B (parent, expect ESCAPE):"; bash $V/nobody.sh B 2>&1
echo "-- arm A (fix, expect BLOCKED):";  bash $V/nobody.sh A 2>&1
echo "########## sandbox --verify both arms x 4 policies"
bash $V/verify-checks.sh A B 2>&1
