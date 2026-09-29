#!/bin/sh
# ASCII build log: N lines on stdout, one error on stderr, exit 3.
N=${1:-3000}
i=1
while [ $i -le $N ]; do echo "compiling module ${i} of ${N} ... ok"; i=$((i+1)); done
echo "ERROR: build failed at step 7 (missing symbol rig_link_target)" >&2
exit 3
