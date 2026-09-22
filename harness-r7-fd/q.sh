#!/bin/bash
# usage: q.sh <arm> <policy> args...   runs the bundled CLI from ws with isolated homes
arm=$1; pol=$2; shift 2
ART=/root/git/qwen-code-verify/tmp/pr12267-verify-20260922-164444
cd "$ART/scratch/ws" || exit 1
case $arm in
  head) CLI=$ART/head-tree/dist/cli.js;;
  prev) CLI=$ART/prev-tree/dist/cli.js;;
  *) echo "unknown arm $arm" >&2; exit 2;;
esac
exec env -u QWEN_RUNTIME_DIR -u SANDBOX -u QWEN_SANDBOX -u QWEN_SANDBOX_NET -u QWEN_SANDBOX_PROXY_COMMAND -u PROXY_COMMAND \
  QWEN_HOME="$ART/scratch/home-$pol" \
  QWEN_CODE_SYSTEM_SETTINGS_PATH=/nonexistent/sys.json \
  QWEN_CODE_SYSTEM_DEFAULTS_PATH=/nonexistent/sysdef.json \
  node "$CLI" "$@"
