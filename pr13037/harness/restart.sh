#!/bin/bash
# usage: [env] restart.sh <jarArm> <db>  -- stop Harness + Spring (by recorded PID), start both again
R=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/19f717cd-fa69-4495-b803-21c540ab1bd6/scratchpad/rig
$R/stop.sh harness spring >/dev/null
$R/start.sh "$@"
