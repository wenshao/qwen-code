#!/bin/bash
# Round 6 on 192.168.0.75 at head 0485bd74e2: L19 (executor background and
# Monitor paths) and L20 (Monitor watcher), per arm.
R=/root/pr13265-rig/r5; ROOT=/sys/fs/cgroup/qwen-h3-pr13265; GUARD=/sys/fs/cgroup/qwen-h3-pr13265-probe; O=$R/out-r6
mkdir -p $O $ROOT $GUARD
grep -qw memory /sys/fs/cgroup/cgroup.subtree_control && echo 3G > $GUARD/memory.max
clean() { for d in $ROOT/qwen-*; do [ -d "$d" ] && { echo 1 > $d/cgroup.kill 2>/dev/null; sleep 0.3; rmdir $d 2>/dev/null; }; done; true; }
run() { local arm=$1 probe=$2 tag=$3; shift 3; clean
  bash -c "echo \$\$ > $GUARD/cgroup.procs; cd /tmp && exec env ARM=$arm CGROUP_ROOT=$ROOT $* timeout 900 node --expose-gc $R/bundles/$arm/$probe.mjs" > $O/$tag.log 2>&1; echo "exit=$?" >> $O/$tag.log
  echo "== $tag: $(tail -1 $O/$tag.log) $(grep -c RESULT $O/$tag.log) result"; }
echo "memory.max=$(cat $GUARD/memory.max 2>/dev/null) kernel=$(uname -r)"
run head l19-executor l19-head ONLY=exit3,monShape
run head l20-monitor l20-head
run nulonly l19-executor l19-nulonly
run nulonly l20-monitor l20-nulonly
run cand l19-executor l19-cand
run cand l19-executor l19-cand-trace TRACE=1 ONLY=bpForeground,bpAfterLauncherExit
run cand l20-monitor l20-cand
run cand l20-monitor l20-cand-2
clean; rmdir $GUARD 2>/dev/null; ls $ROOT | grep -c qwen- || true
