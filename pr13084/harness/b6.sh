#!/bin/bash
# batch s6/s7: read + write cost, head vs base, direct DB and behind +1 ms / +5 ms relays (READ_TIMEOUT=10m on both arms)
R=$(cd $(dirname $0); pwd); cd $R; N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
ok() { grep -q "harness via tap: 200" run/last-restart.log || { echo "RESTART FAILED $*"; tail -5 run/last-restart.log; exit 9; }; }
for d in 1 5; do p=$((24083 + d)); nc -z 127.0.0.1 $p || { nohup $N db-delay.mjs $p 23084 $d > ../logs/relay-$d.log 2>&1 & echo $! > run/relay$d.pid; }; done
sleep 1; nc -z 127.0.0.1 24084 && nc -z 127.0.0.1 24088 && echo "relays up" || { echo "RELAY NOT RUNNING"; exit 3; }
for arm in base:base-a7deb01b head:head-90bd1190; do a=${arm%%:*}; j=${arm##*:}
  READ_TIMEOUT=10m ./restart.sh $j o41cost$a > run/last-restart.log 2>&1; ok $j direct
  DB=o41cost$a ARM=$a ST=st-s5$([ $a = base ] && echo 0 || echo 1) $N s6-cost.mjs 2>&1 | grep -E "^\[(full|range)\]" | cut -c1-700
  DB=o41cost$a ARM=$a SUFFIX=-direct ST=st-s5$([ $a = base ] && echo 2 || echo 3) $N s7-write.mjs 2>&1 | grep -E "^\[result\]" | cut -c1-700
  for d in 1 5; do
    DB_PORT=$((24083 + d)) READ_TIMEOUT=10m ./restart.sh $j o41cost$a > run/last-restart.log 2>&1; ok $j relay$d
    DB=o41cost$a ARM=$a SUFFIX=-r$d $N s6-cost.mjs 2>&1 | grep -E "^\[(full|range)\]" | cut -c1-700
  done
  DB_PORT=24084 READ_TIMEOUT=10m ./restart.sh $j o41cost$a > run/last-restart.log 2>&1; ok $j relay1-write
  DB=o41cost$a ARM=$a SUFFIX=-r1 ST=st-s5$([ $a = base ] && echo 4 || echo 5) $N s7-write.mjs 2>&1 | grep -E "^\[result\]" | cut -c1-700
done
echo BATCH6-DONE
