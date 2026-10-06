#!/bin/bash
# Round 13 on 192.168.0.75 at head c370c5582b (head15) and head15 + the two
# remaining round-3 edits (rest15): supervisor probes, L15b, the executor
# (incl. routeTerminate, bounded waits) and the watcher.
R=/root/pr13265-rig/r5; ROOT=/sys/fs/cgroup/qwen-h3-pr13265; GUARD=/sys/fs/cgroup/qwen-h3-pr13265-probe; O=$R/out-r13
mkdir -p $O $ROOT $GUARD
grep -qw memory /sys/fs/cgroup/cgroup.subtree_control && echo 3G > $GUARD/memory.max
clean() { for d in $ROOT/qwen-*; do [ -d "$d" ] && { echo 1 > $d/cgroup.kill 2>/dev/null; sleep 0.3; rmdir $d 2>/dev/null; }; done; true; }
run() { local arm=$1 probe=$2 tag=$3; shift 3; clean
  bash -c "echo \$\$ > $GUARD/cgroup.procs; cd /tmp && exec env ARM=$arm DIST=bundled CGROUP_ROOT=$ROOT $* timeout 900 node --expose-gc $R/bundles/$arm/$probe.mjs" > $O/$tag.log 2>&1; echo "exit=$?" >> $O/$tag.log
  echo "== $tag: $(tail -1 $O/$tag.log) $(grep -c RESULT $O/$tag.log) result"; }
echo "memory.max=$(cat $GUARD/memory.max 2>/dev/null) kernel=$(uname -r)"
for arm in head15 rest15; do
  run $arm b-l1-supervisor l1-$arm
  run $arm b-l13-fast-start l13-$arm N=30
  run $arm b-l14-terminate-race l14-$arm N=20
  run $arm b-l15b-hold l15b-$arm
  run $arm l19-executor l19-$arm
  run $arm l20-monitor l20-$arm
done
clean; rmdir $GUARD 2>/dev/null; ls $ROOT | grep -c qwen- || true
