#!/bin/bash
# usage: q.sh <arm> <policy> args...   bundled CLI from ws with isolated homes; arms: head=pr12267-r8, pre=pr12267-r8pre
arm=$1; pol=$2; shift 2
case $arm in head) d=pr12267-r8;; fix) d=pr12267-r8fix;; pre) d=pr12267-r8pre;; *) d=$arm;; esac
cd /root/verify/h12267r8/ws
exec env QWEN_HOME=/root/verify/h12267r8/home-$pol QWEN_CODE_SYSTEM_SETTINGS_PATH=/nonexistent/sys.json QWEN_CODE_SYSTEM_DEFAULTS_PATH=/nonexistent/sysdef.json node /root/verify/$d/dist/cli.js "$@"
