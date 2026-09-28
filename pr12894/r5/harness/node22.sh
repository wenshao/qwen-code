#!/bin/sh
# Rig wrapper for the Broker's node executable: logs each worker launch.
echo "$(date +%H:%M:%S) launch pid=$$ args=$*" >> "${RIG_LAUNCH_LOG:-/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/01614b74-ad2d-46ba-bd62-6246811907b8/scratchpad/rig/run/launches.log}"
exec /Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node "$@"
