#!/bin/bash
# usage: run-cli.sh <arm> <home> <cwd> -- <qwen args...>
ARM=$1; H=$2; CWD=$3; shift 4
cd "$CWD"
exec env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy -u NO_COLOR \
  -u QWEN_HOME -u QWEN_RUNTIME_DIR -u OPENAI_API_KEY -u OPENAI_BASE_URL -u DASHSCOPE_API_KEY \
  HOME="$H" USERPROFILE="$H" QWEN_SANDBOX=false QWEN_CODE_NO_RELAUNCH=1 TERM=dumb \
  node /root/verify/pr13379/$ARM/dist/cli.js "$@"
