#!/bin/bash
# s10c: back-to-back pairs at the same host load, local MySQL, default heap and budget: PR head vs candidate.
R=$(cd $(dirname $0); pwd); cd $R; LOG=$R/out/s10c-paired.log; : > $LOG
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
read -r LS LA LR < <($N -e "const r=require('./out/s4.json').find(x=>x.case==='log100');console.log(r.session, r.stdout.id, r.stdout.sha256)")
read -r GS GA GR < <($N -e "const r=require('./out/s5-gib.json');console.log(r.session, r.stdout.id, r.stdout.sha256)")
for ARM in pr cand pr cand; do
  ARTIFACTS=true PUB_ORIGINAL=true PUB_PREVIEW=true ./restart.sh $ARM ${DB:-o3c} > /dev/null
  L=$(uptime | sed 's/.*averages: //' | cut -d' ' -f1)
  echo "$(./t-dl.sh "$ARM, 99 MiB (load $L)" $LS $LA $LR)" | tee -a $LOG
  echo "$(./t-dl.sh "$ARM, 1 GiB (load $L)" $GS $GA $GR)" | tee -a $LOG
done
ARTIFACTS=true PUB_ORIGINAL=true PUB_PREVIEW=true ./restart.sh pr ${DB:-o3c} | tail -1
