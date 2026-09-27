#!/bin/bash
# Runs the mutation matrix in two parallel queues.
S=${WORKDIR:?set WORKDIR to the scratch directory}
R=$S/probe/run-mutant.sh
q1() { $R ctl none runtime-broker; for m in M01 M03 M05 M07 M10 M12 M04; do $R $m $m runtime-broker; done; $R oldc-ctl none rb-oldc; $R oldc-M05 M05 rb-oldc; $R oldc-M10 M10 rb-oldc; }
q2() { for m in M02 M06 M08 M11 M13 M09; do $R $m $m runtime-broker; done; $R bshim none rb-bshim; $R oldc-M07 M07 rb-oldc; $R oldc-M12 M12 rb-oldc; }
q1 > $S/logs/matrix-q1.log 2>&1 &
q2 > $S/logs/matrix-q2.log 2>&1 &
wait
echo "matrix done $(date)"
