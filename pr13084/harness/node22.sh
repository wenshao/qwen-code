#!/bin/sh
# Rig wrapper for the Broker's node executable: logs each worker launch.
echo "$(date +%H:%M:%S) launch pid=$$ args=$*" >> "${RIG_LAUNCH_LOG:-/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/e46b98ed-673c-4dc9-a786-247efff94c81/scratchpad/rig/run/launches.log}"
exec /Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node "$@"
