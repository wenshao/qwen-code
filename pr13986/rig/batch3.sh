#!/bin/bash
# Broker-restart follow-ups: is the 503 close permanent, pre-existing without a
# Harness restart, and does it also hit a live run?
cd /root/pr13986-rig
run() { echo "$(date +%T) >>> $*"; "$@" 2>&1 | grep -E "RESULT|booted|DONE|FAILED|harness stderr" ; }
run bash scen3.sh s9-exit-broker-restart-noharness base
run bash scen3.sh s9-exit-broker-restart-noharness pr
run bash scen3.sh s2c-exit-broker-restart-retry base
run bash scen3.sh s2c-exit-broker-restart-retry pr
run bash scen3.sh s11-live-broker-restart-noharness base
run bash scen3.sh s10-live-broker-restart base
run bash scen3.sh s10-live-broker-restart pr
echo "$(date +%T) BATCH3-DONE"
