#!/bin/bash
# Round 9 on 192.168.0.75: fixr10 = 2a3688d703 + the two remaining
# candidate-r3 edits (H3 wait-after-kill, H4 signal re-raise) +
# fix-terminate-race-r9.mjs. The supervisor probes, the stop scenarios and L15b.
R=/root/pr13265-rig/r5; ROOT=/sys/fs/cgroup/qwen-h3-pr13265; GUARD=/sys/fs/cgroup/qwen-h3-pr13265-probe; O=$R/out-r9b
mkdir -p $O $ROOT $GUARD
grep -qw memory /sys/fs/cgroup/cgroup.subtree_control && echo 3G > $GUARD/memory.max
clean() { for d in $ROOT/qwen-*; do [ -d "$d" ] && { echo 1 > $d/cgroup.kill 2>/dev/null; sleep 0.3; rmdir $d 2>/dev/null; }; done; true; }
run() { local arm=$1 probe=$2 tag=$3; shift 3; clean
  bash -c "echo \$\$ > $GUARD/cgroup.procs; cd /tmp && exec env ARM=$arm DIST=bundled CGROUP_ROOT=$ROOT $* timeout 900 node --expose-gc $R/bundles/$arm/$probe.mjs" > $O/$tag.log 2>&1; echo "exit=$?" >> $O/$tag.log
  echo "== $tag: $(tail -1 $O/$tag.log) $(grep -c RESULT $O/$tag.log) result"; }
run fixr10 b-l1-supervisor l1-fixr10
run fixr10 b-l14-terminate-race l14-fixr10 N=20
run fixr10 l19-executor l19-fixr10-stop ONLY=setsidDaemon,childHoldsPipes,drain,routeTerminate
run fixr10 b-l15b-hold l15b-fixr10
clean; rmdir $GUARD 2>/dev/null; ls $ROOT | grep -c qwen- || true
