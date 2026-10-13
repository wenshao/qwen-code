#!/bin/bash
# Follow-ups: s3 on base (is the stale record pre-existing?), the review's
# shape via a Broker restart (prefix vs pr), the next-Session cost of a strand,
# then V69 on MySQL 8.4 and MariaDB with a populated ledger.
cd /root/pr13986-rig
run() { echo "$(date +%T) >>> $*"; "$@" 2>&1 | grep -E "RESULT|booted|DONE|FAILED|holds:|harness stderr|EXPLAIN|V69|SHOW|engine|inserted|history|query ms|matched|base:|pr:" ; }
run bash scen2.sh s3-restore-only base
run bash scen2.sh s2b-exit-broker-restart prefix
run bash scen2.sh s2b-exit-broker-restart pr
run bash scen2.sh s8-next-session base
run bash scen2.sh s8-next-session pr
bash rig-reset.sh > /dev/null 2>&1
run bash flyway-index.sh mariadb
run bash flyway-index.sh mysql84
echo "$(date +%T) BATCH2-DONE"
