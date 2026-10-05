#!/bin/bash
# Round 9 on 192.168.0.75: L19 again with the probe's cleanup recording
# instead of crashing, plus routeTerminate (shell-terminate on an ordinary
# running background Shell, 10x per command) — final head 2a3688d703 (head10),
# head10 + the two remaining edits (rest10), and head9 (4b339c9140) for the
# stop scenarios only.
R=/root/pr13265-rig/r5; ROOT=/sys/fs/cgroup/qwen-h3-pr13265; GUARD=/sys/fs/cgroup/qwen-h3-pr13265-probe; O=$R/out-r9b
mkdir -p $O $ROOT $GUARD
grep -qw memory /sys/fs/cgroup/cgroup.subtree_control && echo 3G > $GUARD/memory.max
clean() { for d in $ROOT/qwen-*; do [ -d "$d" ] && { echo 1 > $d/cgroup.kill 2>/dev/null; sleep 0.3; rmdir $d 2>/dev/null; }; done; true; }
run() { local arm=$1 probe=$2 tag=$3; shift 3; clean
  bash -c "echo \$\$ > $GUARD/cgroup.procs; cd /tmp && exec env ARM=$arm DIST=bundled CGROUP_ROOT=$ROOT $* timeout 900 node --expose-gc $R/bundles/$arm/$probe.mjs" > $O/$tag.log 2>&1; echo "exit=$?" >> $O/$tag.log
  echo "== $tag: $(tail -1 $O/$tag.log) $(grep -c RESULT $O/$tag.log) result"; }
run head10 l19-executor l19-head10
run rest10 l19-executor l19-rest10
run head9 l19-executor l19-head9-stop ONLY=drain,routeTerminate
clean; rmdir $GUARD 2>/dev/null; ls $ROOT | grep -c qwen- || true
