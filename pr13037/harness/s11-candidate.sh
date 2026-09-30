#!/bin/bash
# s11: the candidate patch (candidate-80a860ae.patch) on the same stack and schema.
R=$(cd $(dirname $0); pwd); cd $R; LOG=$R/out/s11-candidate.log; : > $LOG
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
read -r LS LA LR < <($N -e "const r=require('./out/s4.json').find(x=>x.case==='log100');console.log(r.session, r.stdout.id, r.stdout.sha256)")
read -r GS GA GR < <($N -e "const r=require('./out/s5-gib.json');console.log(r.session, r.stdout.id, r.stdout.sha256)")
say() { echo "$*" | tee -a $LOG; }
DB_PORT=24037 ARTIFACTS=true PUB_ORIGINAL=true PUB_PREVIEW=true ./restart.sh cand ${DB:-o3c} | tail -1
say "load: $(uptime | sed 's/.*averages: //')"
say "$(./t-dl.sh 'candidate, DB behind the relay, 99 MiB' $LS $LA $LR)"
say "$(./t-dl.sh 'candidate, DB behind the relay, 1 GiB' $GS $GA $GR)"
ARTIFACTS=true PUB_ORIGINAL=true PUB_PREVIEW=true ./restart.sh cand ${DB:-o3c} | tail -1
say "$(./t-dl.sh 'candidate, direct DB, 99 MiB' $LS $LA $LR)"
say "$(./t-dl.sh 'candidate, direct DB, 1 GiB' $GS $GA $GR)"
say "abort timing: $($N t-abort-timing.mjs 2>&1 | cut -c1-400)"
say "load: $(uptime | sed 's/.*averages: //')"
say "$(ONLY_DL=1 COST_LOG=t-cost-cand $N t-cost.mjs 2>&1 | /usr/bin/grep 'full download' | cut -c1-400)"
# revocation in the middle of a slow full download: how many bytes are still delivered afterwards?
say "$(FROM=s1a $N t-revoke.mjs 2>&1 | cut -c1-400)"
