#!/bin/bash
# Re-run the core matrix on the new head: pr2 = main@58c59136ca + f3eeac2865,
# base2 = main@58c59136ca.
cd /root/pr13986-rig
run() { echo "$(date +%T) >>> $*"; "$@" 2>&1 | grep -E "RESULT|booted|DONE|FAILED|harness stderr" ; }
run bash scen3.sh s0-close-no-restart pr2
run bash scen3.sh s1-restart-term base2
run bash scen3.sh s1-restart-term pr2
run bash scen3.sh s1-restart-kill pr2
run bash scen3.sh s2-exit-then-restart pr2
run bash scen3.sh s3-restore-only pr2
run bash scen3.sh s4-monitor base2
run bash scen3.sh s4-monitor pr2
run bash scen3.sh s5-isolation pr2
run bash scen3.sh s8-next-session base2
run bash scen3.sh s8-next-session pr2
run bash scen3.sh s6-degrade base2 pr2
run bash scen3.sh s7-detach-load pr2
echo "$(date +%T) BATCH4-DONE"
