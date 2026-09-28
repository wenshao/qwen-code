#!/bin/sh
# buildlog with an optional pause before the stderr error line.
N=${1:-3000}; P=${2:-0}
i=1
while [ $i -le $N ]; do echo "compiling module ${i} of ${N} ... ok"; i=$((i+1)); done
[ "$P" != "0" ] && sleep $P
echo "ERROR: build failed at step 7 (missing symbol rig_link_target)" >&2
exit 3
