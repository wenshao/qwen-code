#!/bin/bash
L=${LANE:-1}; P=$((18644+10*L))
sp=$(lsof -nP -iTCP:$P -sTCP:LISTEN -t)
[ -z "$sp" ] && exit 0
ps -o command= -p $sp | grep -q "8b5b6f90" || { echo "$P Spring belongs to another rig"; exit 1; }
kids=$(ps -ax -o pid=,ppid= | awk -v p=$sp '$2==p{print $1}')
kill $sp $kids 2>/dev/null
for i in $(seq 1 40); do lsof -nP -iTCP:$P -sTCP:LISTEN -t >/dev/null || break; sleep 1; done
lsof -nP -iTCP:$P -sTCP:LISTEN -t >/dev/null && { kill -9 $sp; sleep 1; }
echo "lane $L stopped $sp"
