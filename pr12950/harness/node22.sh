#!/bin/sh
# Rig wrapper for the Broker's node executable: logs each worker launch.
echo "$(date +%H:%M:%S) launch pid=$$ args=$*" >> "${RIG_LAUNCH_LOG:-<rig>/rig/run/launches.log}"
exec ~/.local/share/fnm/node-versions/v22.23.2/installation/bin/node "$@"
