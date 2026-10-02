#!/bin/bash
# batch s3: head + base, each run on a fresh 64 MiB artifact
R=$(cd $(dirname $0); pwd); cd $R; N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
run() { # arm jar db readTimeout mode st suffix
  READ_TIMEOUT=$4 ./restart.sh $2 $3 > run/last-restart.log 2>&1
  grep -q "harness via tap: 200" run/last-restart.log || { echo "RESTART FAILED $2 $3"; cat run/last-restart.log; return 1; }
  DB=$3 ARM=$1 MODE=$5 ST=$6 SUFFIX=$7 READ_TIMEOUT=$4 $N s3-reads.mjs 2>&1 | grep -E "^\[(made|result)\]" | cut -c1-900
}
run head head-90bd1190 o41reads ""  expire  st-s20 -2m
run head head-90bd1190 o41reads 10m expire  st-s21 -10m
run head head-90bd1190 o41reads ""  sigstop st-s22 ""
run head head-90bd1190 o41reads ""  delete  st-s23 ""
run base base-a7deb01b o41readsb 10m expire st-s24 -10m
run base base-a7deb01b o41readsb ""  expire st-s25 -2m
run base base-a7deb01b o41readsb ""  sigstop st-s26 ""
run base base-a7deb01b o41readsb ""  delete st-s27 ""
echo BATCH-DONE
