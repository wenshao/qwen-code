#!/bin/bash
# usage: [env] restart.sh <jarArm> <db> [extra]  -- stop Harness + Spring (by recorded PID), start both again
/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/e46b98ed-673c-4dc9-a786-247efff94c81/scratchpad/rig/stop.sh harness spring >/dev/null
/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/e46b98ed-673c-4dc9-a786-247efff94c81/scratchpad/rig/start.sh "$@"
