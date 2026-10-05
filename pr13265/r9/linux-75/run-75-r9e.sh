#!/bin/bash
# Round 9 on 192.168.0.75: fix10 = 2a3688d703 + fix-terminate-race-r9.mjs
# (terminate answers the natural end's evidence when that settle removed the
# unit first). Stop scenarios, the long-lived-member scenarios, and L15b.
R=/root/pr13265-rig/r5; ROOT=/sys/fs/cgroup/qwen-h3-pr13265; GUARD=/sys/fs/cgroup/qwen-h3-pr13265-probe; O=$R/out-r9b
mkdir -p $O $ROOT $GUARD
grep -qw memory /sys/fs/cgroup/cgroup.subtree_control && echo 3G > $GUARD/memory.max
clean() { for d in $ROOT/qwen-*; do [ -d "$d" ] && { echo 1 > $d/cgroup.kill 2>/dev/null; sleep 0.3; rmdir $d 2>/dev/null; }; done; true; }
run() { local arm=$1 probe=$2 tag=$3; shift 3; clean
  bash -c "echo \$\$ > $GUARD/cgroup.procs; cd /tmp && exec env ARM=$arm DIST=bundled CGROUP_ROOT=$ROOT $* timeout 900 node --expose-gc $R/bundles/$arm/$probe.mjs" > $O/$tag.log 2>&1; echo "exit=$?" >> $O/$tag.log
  echo "== $tag: $(tail -1 $O/$tag.log) $(grep -c RESULT $O/$tag.log) result"; }
run fix10 l19-executor l19-fix10-stop ONLY=setsidDaemon,childHoldsPipes,drain,routeTerminate
run fix10 b-l15b-hold l15b-fix10
clean; rmdir $GUARD 2>/dev/null; ls $ROOT | grep -c qwen- || true
