#!/bin/bash
# s10d: PR head and candidate back to back, database behind the +1 ms/packet relay, 99 MiB (twice each, alternating).
R=$(cd $(dirname $0); pwd); cd $R; LOG=$R/out/s10d-relay-paired.log; : > $LOG
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
read -r LS LA LR < <($N -e "const r=require('./out/s4.json').find(x=>x.case==='log100');console.log(r.session, r.stdout.id, r.stdout.sha256)")
[ ${#LR} -eq 64 ] || { echo "no artifact sha" | tee -a $LOG; exit 2; }
nc -z 127.0.0.1 24037 || { echo "RELAY NOT RUNNING" | tee -a $LOG; exit 3; }
for round in 1 2; do for arm in pr cand; do
  DB_PORT=24037 ARTIFACTS=true PUB_ORIGINAL=true PUB_PREVIEW=true ./restart.sh $arm ${DB:-o3g} > run/last-restart.log 2>&1
  grep -q "harness via tap: 200" run/last-restart.log || { echo "RESTART FAILED $arm" | tee -a $LOG; exit 9; }
  echo "$(./t-dl.sh "$arm, DB behind the relay, 99 MiB (round $round, load $(uptime | sed 's/.*averages: //' | cut -d' ' -f1))" $LS $LA $LR)" | tee -a $LOG
done; done
ARTIFACTS=true PUB_ORIGINAL=true PUB_PREVIEW=true ./restart.sh pr ${DB:-o3g} | tail -1
