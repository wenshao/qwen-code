#!/bin/bash
# N2: named FIFO whose writer stays open -> does the CLI return when the confined command is done?
H=/root/verify/h12267r8; cd $H; Q=$H/q.sh
hdr() { printf '\033[1;36m%s\033[0m\n' "$*"; }
arms=${ARMS:-pre head}
writer() { python3 -c 'import os,sys,time; fd=os.open(sys.argv[1], os.O_WRONLY); os.write(fd, sys.argv[2].encode()); time.sleep(float(sys.argv[3]))' "$@"; }
row() { # label arm cmd... ; writer writes $DATA then keeps the FIFO open 12 s
  local label=$1 arm=$2; shift 2
  rm -f f.fifo; mkfifo f.fifo
  writer f.fifo "$DATA" 12 & local wp=$!
  local t0=$(date +%s%N)
  if [ "$arm" = none ]; then out=$(timeout -k 2 30 "$@" < f.fifo); rc=$?
  else out=$(timeout -k 2 30 $Q $arm ww-closed sandbox -- "$@" < f.fifo 2>/dev/null); rc=$?; fi
  local ms=$(( ($(date +%s%N)-t0)/1000000 ))
  printf '  %-26s arm=%-4s rc=%-3s %6s ms  out=%s\n' "$label" $arm $rc $ms "$(echo "$out"|tr '\n' ' ')"
  kill $wp 2>/dev/null; wait $wp 2>/dev/null
}
hdr '# writer: opens f.fifo, writes "first\n", keeps it open for 12 s'
DATA=$'first\n'
for a in none $arms; do row 'head -n1 < f.fifo' $a head -n1; done
hdr '# writer: opens f.fifo, writes nothing, keeps it open for 12 s'
DATA=''
for a in none $arms; do row 'echo done < f.fifo' $a echo done; done
rm -f f.fifo
