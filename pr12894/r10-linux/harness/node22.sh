#!/bin/sh
# Rig wrapper for the Broker's node executable: logs each worker launch.
echo "$(date +%H:%M:%S) launch pid=$$ args=$*" >> "${RIG_LAUNCH_LOG:-/root/rig/run/launches.log}"
exec /usr/bin/node "$@"
