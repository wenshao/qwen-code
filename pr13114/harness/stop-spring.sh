#!/bin/bash
# Stop the rig Spring (port 18894) and its JDI tap and worker children, by PID only.
sp=$(lsof -nP -iTCP:18894 -sTCP:LISTEN -t)
[ -z "$sp" ] && exit 0
ps -o command= -p $sp | grep -q "server.port=18894" || { echo "18894 is not the rig Spring"; exit 1; }
ps -o command= -p $sp | grep -q "e298c115" || { echo "18894 Spring belongs to another rig"; exit 1; }
tp=$(lsof -nP -iTCP:15894 -sTCP:ESTABLISHED -t 2>/dev/null | grep -v "^$sp$")
kids=$(ps -ax -o pid=,ppid= | awk -v p=$sp '$2==p{print $1}')
kill $sp $tp $kids 2>/dev/null
for i in $(seq 1 30); do lsof -nP -iTCP:18894 -sTCP:LISTEN -t >/dev/null || break; sleep 1; done
