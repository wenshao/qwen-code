#!/bin/bash
while true; do T=$(date +%s); ps -axo pid=,ppid=,rss=,command= | awk -v t=$T -v sp=44660 '($2==sp && /managed-runtime-worker/) {print t, $1, $3, "worker"} ($1==sp) {print t, $1, $3, "java"}' >> $1; sleep 0.25; done
