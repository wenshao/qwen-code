#!/bin/bash
R=/root/verify/pr12546-rig
xargs -P 6 -L 1 $R/runab.sh < $R/${1:-jobs.txt}
echo MATRIX_DONE
