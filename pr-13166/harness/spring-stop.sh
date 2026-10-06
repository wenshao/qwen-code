#!/bin/bash
# VERIFICATION RIG ONLY: stop the rig's Spring by its recorded PID (never by pattern).
RUN=/root/verify/pr13166/rig/run/$1; P=$(cat $RUN/spring.pid 2>/dev/null) || exit 0
kill $P 2>/dev/null; for i in $(seq 1 40); do kill -0 $P 2>/dev/null || { echo "spring $P stopped"; exit 0; }; sleep 0.5; done; kill -9 $P; echo "spring $P killed"
