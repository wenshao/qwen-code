#!/bin/bash
# q.sh <arm A|B> <pol> args...  -- runs the bundled CLI from ws with an isolated operator home
arm=$1; pol=$2; shift 2
cd /root/verify/r7/ws
exec env QWEN_HOME=/root/verify/r7/home-$pol \
  QWEN_CODE_SYSTEM_SETTINGS_PATH=/nonexistent/sys.json \
  QWEN_CODE_SYSTEM_DEFAULTS_PATH=/nonexistent/sysdef.json \
  node /root/verify/r7/dist-$arm/cli.js "$@"
