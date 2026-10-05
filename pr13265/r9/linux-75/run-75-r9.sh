#!/bin/bash
# Round 9 on 192.168.0.75 at head 4b339c9140: the supervisor probes (L1, L13,
# L14) and the executor/watcher probes (L19, L20) for the head as built and
# for head + the two remaining candidate edits (H3 wait-after-kill, H4
# signal re-raise).
R=/root/pr13265-rig/r5; ROOT=/sys/fs/cgroup/qwen-h3-pr13265; GUARD=/sys/fs/cgroup/qwen-h3-pr13265-probe; O=$R/out-r9
mkdir -p $O $ROOT $GUARD
grep -qw memory /sys/fs/cgroup/cgroup.subtree_control && echo 3G > $GUARD/memory.max
clean() { for d in $ROOT/qwen-*; do [ -d "$d" ] && { echo 1 > $d/cgroup.kill 2>/dev/null; sleep 0.3; rmdir $d 2>/dev/null; }; done; true; }
run() { local arm=$1 probe=$2 tag=$3; shift 3; clean
  bash -c "echo \$\$ > $GUARD/cgroup.procs; cd /tmp && exec env ARM=$arm DIST=bundled CGROUP_ROOT=$ROOT $* timeout 900 node --expose-gc $R/bundles/$arm/$probe.mjs" > $O/$tag.log 2>&1; echo "exit=$?" >> $O/$tag.log
  echo "== $tag: $(tail -1 $O/$tag.log) $(grep -c RESULT $O/$tag.log) result"; }
echo "memory.max=$(cat $GUARD/memory.max 2>/dev/null) kernel=$(uname -r)"
for arm in head9 rest9; do
  run $arm b-l1-supervisor l1-$arm
  run $arm b-l13-fast-start l13-$arm N=30
  run $arm b-l14-terminate-race l14-$arm N=20
  run $arm l19-executor l19-$arm
  run $arm l20-monitor l20-$arm
done
run head9 l19-executor l19-head9-trace TRACE=1 ONLY=bpForeground,bpAfterLauncherExit
clean; rmdir $GUARD 2>/dev/null; ls $ROOT | grep -c qwen- || true
