#!/bin/bash
# s12b: full download of the 99 MiB output from the real bucket: PR head vs candidate, 2 runs each.
R=$(cd $(dirname $0); pwd); cd $R; S=$(dirname $R); LOG=$R/out/s12b-realoss-download.log; : > $LOG
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
read -r LS LA LR < <($N -e "const r=require('./out/s12-realoss.json').log100;console.log(r.session, r.stdout.id, r.stdout.sha256)")
B=$(cat $S/realoss/bucket.txt)
say() { echo "$*" | tee -a $LOG; }
for ARM in pr cand pr cand; do
  OSS_MODE=real OSS_BUCKET=$B ARTIFACTS=true PUB_ORIGINAL=true PUB_PREVIEW=true ./restart.sh $ARM ${DB:-o3r2} > /dev/null
  say "$(./t-dl.sh "real OSS, $ARM, 99 MiB" $LS $LA $LR)"
done
