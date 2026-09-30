#!/bin/sh
# VERIFICATION RIG ONLY: Broker node executable wrapper; logs each worker launch.
echo "$(date +%H:%M:%S) launch pid=$$ args=$*" >> "${RIG_LAUNCH_LOG:-/Users/wenshao/pr13116-rig/stack/run/launches.log}"
exec /Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node "$@"
