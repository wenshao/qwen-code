#!/bin/sh
# Rig wrapper for QWEN_MANAGED_AGENT_NODE_EXECUTABLE: logs each worker launch.
echo "$(date +%H:%M:%S) launch pid=$$ ppid=$PPID args=$*" >> "${RIG_LAUNCH_LOG:-/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04201ac3-a139-4b74-bbd7-d1f0edfd79c5/scratchpad/rig/launches.log}"
exec /Users/wenshao/.local/state/fnm_multishells/63323_1790424696220/bin/node "$@"
