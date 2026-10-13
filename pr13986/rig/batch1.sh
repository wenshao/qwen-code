#!/bin/bash
# Main matrix, sequential (one stack at a time on this host).
cd /root/pr13986-rig
run() { echo "$(date +%T) >>> $*"; "$@" 2>&1 | grep -E "RESULT|booted|DONE|FAILED|holds:|harness stderr" ; }
# s0 base already ran (21:11)
run bash scen.sh s1-restart-term base
run bash scen.sh s1-restart-term pr
run bash scen.sh s2-exit-then-restart base
run bash scen.sh s2-exit-then-restart prefix
run bash scen.sh s2-exit-then-restart pr
run bash scen.sh s3-restore-only pr
run bash scen.sh s4-monitor base
run bash scen.sh s4-monitor pr
run bash scen.sh s5-isolation pr
run bash scen.sh s7-detach-load base
run bash scen.sh s7-detach-load pr
# degrade: mixed version (new Harness, old Broker) and old Harness + new Broker
run bash scen.sh s6-degrade base pr
run bash scen.sh s1-restart-term pr base
# degrade through the fault proxy on the new route only
VIA_PROXY=1 PROXY_RULES='[{"path":"/tool-sessions:active-holds","action":"status","status":500,"body":{"code":"rig_injected_500"}}]' run bash scen.sh s6-degrade pr
mv out/s6-degrade.pr.h-pr out/s6-degrade.pr.h-pr.p500; mv out/s6-degrade.pr.h-pr.state.json out/s6-degrade.pr.h-pr.p500.state.json 2>/dev/null
VIA_PROXY=1 PROXY_RULES='[{"path":"/tool-sessions:active-holds","action":"rewrite","body":{"heldRuntimeSessionIds":["../escape"]}}]' run bash scen.sh s6-degrade pr
mv out/s6-degrade.pr.h-pr out/s6-degrade.pr.h-pr.pinvalid
VIA_PROXY=1 PROXY_RULES='[{"path":"/tool-sessions:active-holds","action":"hang"}]' run bash scen.sh s6-degrade pr
mv out/s6-degrade.pr.h-pr out/s6-degrade.pr.h-pr.phang
VIA_PROXY=1 PROXY_RULES='[]' run bash scen.sh s6-degrade pr
mv out/s6-degrade.pr.h-pr out/s6-degrade.pr.h-pr.ptransparent
# crash restart (writer lease must lapse before the load)
run bash scen.sh s1-restart-kill base
run bash scen.sh s1-restart-kill pr
echo "$(date +%T) BATCH1-DONE"
