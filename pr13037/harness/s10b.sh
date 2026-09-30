#!/bin/bash
# s10b: PR head, default heap, default 2-minute budget, local MySQL: full download of the 1 GiB output (twice).
R=$(cd $(dirname $0); pwd); cd $R; LOG=$R/out/s10-dblatency.log
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
read -r GS GA GR < <($N -e "const r=require('./out/s5-gib.json');console.log(r.session, r.stdout.id, r.stdout.sha256)")
for i in 1 2; do echo "$(./t-dl.sh "direct DB, 1 GiB, default heap and budget (run $i, load $(uptime | sed 's/.*averages: //' | cut -d' ' -f1))" $GS $GA $GR)" | tee -a $LOG; done
