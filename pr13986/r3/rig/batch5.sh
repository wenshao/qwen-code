#!/bin/bash
# Round 3: pr3 = main@462cae3dd8 + 82e83f0d2c (schema-32 port), base3 = main@462cae3dd8.
cd /root/pr13986-rig
run() { echo "$(date +%T) >>> $*"; "$@" 2>&1 | grep -E "RESULT|booted|DONE|FAILED|harness stderr|BOOT" ; }
run bash scen4.sh s0-close-no-restart base3
run bash scen4.sh s1-restart-term base3
run bash scen4.sh s1-restart-term pr3
run bash scen4.sh s1-restart-kill base3
run bash scen4.sh s1-restart-kill pr3
run bash scen4.sh s4-monitor base3
run bash scen4.sh s4-monitor pr3
run bash scen4.sh s2-exit-then-restart base3
run bash scen4.sh s2-exit-then-restart pr3
run bash scen4.sh s8-next-session base3
run bash scen4.sh s8-next-session pr3
run bash scen4.sh s3-restore-only pr3
run bash scen4.sh s5-isolation pr3
run bash scen4.sh s7-detach-load pr3
# mixed versions
run bash scen4.sh s6-degrade base3 pr3
run bash scen4.sh s1-restart-term pr3 base3
# faults on the new route only
VIA_PROXY=1 PROXY_RULES='[{"path":"/tool-sessions:active-holds","action":"status","status":500,"body":{"code":"rig_injected_500"}}]' run bash scen4.sh s6-degrade pr3
mv out/s6-degrade.pr3.h-pr3 out/s6-degrade.pr3.h-pr3.p500
VIA_PROXY=1 PROXY_RULES='[{"path":"/tool-sessions:active-holds","action":"rewrite","body":{"heldRuntimeSessionIds":["../escape"]}}]' run bash scen4.sh s6-degrade pr3
mv out/s6-degrade.pr3.h-pr3 out/s6-degrade.pr3.h-pr3.pinvalid
VIA_PROXY=1 PROXY_RULES='[{"path":"/tool-sessions:active-holds","action":"hang"}]' run bash scen4.sh s6-degrade pr3
mv out/s6-degrade.pr3.h-pr3 out/s6-degrade.pr3.h-pr3.phang
VIA_PROXY=1 PROXY_RULES='[]' run bash scen4.sh s6-degrade pr3
mv out/s6-degrade.pr3.h-pr3 out/s6-degrade.pr3.h-pr3.ptransparent
# F1 recheck on the new main
run bash scen4.sh s11-live-broker-restart-noharness base3
run bash scen4.sh s10-live-broker-restart base3
run bash scen4.sh s10-live-broker-restart pr3
bash rig-reset.sh > /dev/null 2>&1
echo "$(date +%T) BATCH5-DONE"
