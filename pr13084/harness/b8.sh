#!/bin/bash
# batch s8 (one transient OSS 500 on GET and on PUT) + s9 (legacy public DELETE), head and base
R=$(cd $(dirname $0); pwd); cd $R; N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
ok() { grep -q "harness via tap: 200" run/last-restart.log || { echo "RESTART FAILED"; tail -5 run/last-restart.log; exit 9; }; }
for arm in head:head-90bd1190 base:base-a7deb01b; do a=${arm%%:*}; j=${arm##*:}
  ./restart.sh $j o41tr$a > run/last-restart.log 2>&1; ok
  DB=o41tr$a ARM=$a ST=st-s3$([ $a = head ] && echo 2 || echo 4) ST2=st-s3$([ $a = head ] && echo 3 || echo 5) $N s8-oss-transient.mjs 2>&1 | grep -E "^\[" | cut -c1-600
  [ $a = head ] && DB=o41tr$a $N s12-admission-put.mjs 2>&1 | grep -E "^\[" | cut -c1-500
  [ $a = head ] && DB=o41tr$a $N s9-legacy-delete.mjs 2>&1 | grep -E "^\[" | cut -c1-400
  DB=o41tr$a ARM=$a ST=st-s3$([ $a = head ] && echo 6 || echo 7) $N s10-truncate.mjs 2>&1 | grep -E "^\[" | cut -c1-500
done
echo BATCH8-DONE
