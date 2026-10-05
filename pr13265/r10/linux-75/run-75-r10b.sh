#!/bin/bash
# Round 10 on 192.168.0.75: bgValidation through the real executor at
# ce870e6920 (head11, before 581578466b) and edcbe0e537 (head12).
R=/root/pr13265-rig/r5; ROOT=/sys/fs/cgroup/qwen-h3-pr13265; GUARD=/sys/fs/cgroup/qwen-h3-pr13265-probe; O=$R/out-r10
mkdir -p $O $ROOT $GUARD
grep -qw memory /sys/fs/cgroup/cgroup.subtree_control && echo 3G > $GUARD/memory.max
clean() { for d in $ROOT/qwen-*; do [ -d "$d" ] && { echo 1 > $d/cgroup.kill 2>/dev/null; sleep 0.3; rmdir $d 2>/dev/null; }; done; true; }
run() { local arm=$1 probe=$2 tag=$3; shift 3; clean
  bash -c "echo \$\$ > $GUARD/cgroup.procs; cd /tmp && exec env ARM=$arm DIST=bundled CGROUP_ROOT=$ROOT $* timeout 300 node --expose-gc $R/bundles/$arm/$probe.mjs" > $O/$tag.log 2>&1; echo "exit=$?" >> $O/$tag.log
  echo "== $tag: $(tail -1 $O/$tag.log) $(grep -c RESULT $O/$tag.log) result"; }
run head11 l19-executor l19-head11-val ONLY=bgValidation
run head12 l19-executor l19-head12-val ONLY=bgValidation
clean; rmdir $GUARD 2>/dev/null; ls $ROOT | grep -c qwen- || true
