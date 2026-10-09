#!/bin/bash
# Stop rig Spring (18654) and its worker children, by PID only.
sp=$(lsof -nP -iTCP:18654 -sTCP:LISTEN -t)
[ -z "$sp" ] && exit 0
ps -o command= -p $sp | grep -q "8b5b6f90" || { echo "18654 Spring belongs to another rig"; exit 1; }
kids=$(ps -ax -o pid=,ppid= | awk -v p=$sp '$2==p{print $1}')
[ "${KEEP_KIDS:-0}" = 1 ] && kids=""
kill ${SIG:-} $sp $kids 2>/dev/null
for i in $(seq 1 40); do lsof -nP -iTCP:18654 -sTCP:LISTEN -t >/dev/null || break; sleep 1; done
lsof -nP -iTCP:18654 -sTCP:LISTEN -t >/dev/null && { kill -9 $sp; sleep 1; }
echo stopped $sp kids=$(echo $kids)
