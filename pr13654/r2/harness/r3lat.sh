#!/bin/bash
# Paired latency, round 3: lane 2 = base 1f4484d3 (DB p654r3a, already up); lane 1 restarted per arm.
R=$(cd $(dirname $0); pwd)
arm() { local tag=$1 wt=$2 db=$3 n0=$4
  LANE=1 $R/stop-l.sh >/dev/null
  ( export DB=$db ROOTS=$R/roots-$db ASYNC=1; LANE=1 $R/up-l.sh head3 $wt | tail -1 | tee -a $R/out/paired-r3.log )
  CAND=$wt DB1=$db DB2=p654r3a PLOG=paired-r3 PB=$tag N0=$n0 $R/paired2.sh "S M X"
}
arm h $HOME/git/qwen-code-pr13654 p654l1 50
arm c2 $HOME/git/qwen-code-pr13654-cand2 p654l2 60
arm c1 $HOME/git/qwen-code-pr13654-cand p654l3 70
echo "## r3lat done $(date +%T)" | tee -a $R/out/paired-r3.log
