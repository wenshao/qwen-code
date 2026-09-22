#!/bin/bash
# usage: q.sh <arm> <policy> args...   runs the bundled CLI from ws with isolated homes
arm=$1; pol=$2; shift 2
cd /root/verify/h12267r6/ws
exec env QWEN_HOME=/root/verify/h12267r6/home-$pol QWEN_CODE_SYSTEM_SETTINGS_PATH=/nonexistent/sys.json QWEN_CODE_SYSTEM_DEFAULTS_PATH=/nonexistent/sysdef.json node /root/verify/pr12267-$arm/dist/cli.js "$@"
