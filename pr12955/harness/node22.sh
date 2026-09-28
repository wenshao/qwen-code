#!/bin/sh
# Rig wrapper for the Broker's node executable: logs each worker launch.
echo "$(date +%H:%M:%S) launch pid=$$ args=$*" >> "${RIG_LAUNCH_LOG:-/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fc30c1c3-658a-459a-9a85-13701a898397/scratchpad/rig/run/launches.log}"
exec /Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node "$@"
