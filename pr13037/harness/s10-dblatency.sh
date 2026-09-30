#!/bin/bash
# s10: effect of database round-trip latency on the full-download path (27.6 statements per 64 KiB chunk).
R=$(cd $(dirname $0); pwd); cd $R; LOG=$R/out/s10-dblatency.log; : > $LOG
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
read -r LS LA LR < <($N -e "const r=require('./out/s4.json').find(x=>x.case==='log100');console.log(r.session, r.stdout.id, r.stdout.sha256)")
read -r GS GA GR < <($N -e "const r=require('./out/s5-gib.json');console.log(r.session, r.stdout.id, r.stdout.sha256)")
say() { echo "$*" | tee -a $LOG; }
for P in 23037 24037; do say "200 trivial statements via port $P: $( { /usr/bin/time -p /Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -prig13037 -h127.0.0.1 -P$P ${DB:-o3c} -N -e "$(for i in $(seq 1 200); do printf 'SELECT 1;'; done)" >/dev/null; } 2>&1 | /usr/bin/grep real | awk '{print $2}') s"; done
ARTIFACTS=true PUB_ORIGINAL=true PUB_PREVIEW=true ./restart.sh pr ${DB:-o3c} | tail -1
say "load: $(uptime | sed 's/.*averages: //')"
say "$(./t-dl.sh 'direct DB, 99 MiB' $LS $LA $LR)"
say "$(./t-dl.sh 'direct DB, 99 MiB (repeat)' $LS $LA $LR)"
DB_PORT=24037 ARTIFACTS=true PUB_ORIGINAL=true PUB_PREVIEW=true ./restart.sh pr ${DB:-o3c} | tail -1
say "$(./t-dl.sh 'DB behind the relay, 99 MiB' $LS $LA $LR)"
say "$(./t-dl.sh 'DB behind the relay, 1 GiB' $GS $GA $GR)"
say "load: $(uptime | sed 's/.*averages: //')"
