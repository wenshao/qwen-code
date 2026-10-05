#!/bin/bash
# Round 9 on 192.168.0.75: L15b (H7b/H5 hold semantics) for the round-9 head
# before the fix (head9 = 4b339c9140), the final head 2a3688d703 (head10) and
# head10 + the two remaining candidate edits (rest10).
R=/root/pr13265-rig/r5; ROOT=/sys/fs/cgroup/qwen-h3-pr13265; GUARD=/sys/fs/cgroup/qwen-h3-pr13265-probe; O=$R/out-r9b
mkdir -p $O $ROOT $GUARD
grep -qw memory /sys/fs/cgroup/cgroup.subtree_control && echo 3G > $GUARD/memory.max
clean() { for d in $ROOT/qwen-*; do [ -d "$d" ] && { echo 1 > $d/cgroup.kill 2>/dev/null; sleep 0.3; rmdir $d 2>/dev/null; }; done; true; }
for arm in head9 head10 rest10; do clean
  bash -c "echo \$\$ > $GUARD/cgroup.procs; cd /tmp && exec env ARM=$arm DIST=bundled CGROUP_ROOT=$ROOT timeout 300 node --expose-gc $R/bundles/$arm/b-l15b-hold.mjs" > $O/l15b-$arm.log 2>&1; echo "exit=$?" >> $O/l15b-$arm.log
  echo "== l15b-$arm: $(tail -1 $O/l15b-$arm.log) $(grep -c RESULT $O/l15b-$arm.log) result"
done
clean; ls $ROOT | grep -c qwen- || true
