#!/bin/bash
# run-tui.sh <arm> <scenario-dir> <tmux-session> [extra cli args...]
set -eu; source /root/git/h12374-e2e/env.sh
ARM=$1; SC=$2; S=$3; shift 3
CLI=${ARM_CLI[$ARM]}; test -f "$CLI"
tmux -L $TSOCK kill-session -t "$S" 2>/dev/null || true
tmux -L $TSOCK new-session -d -s "$S" -x 160 -y 42 \
  "cd $SC/ws/app && env -u QWEN_DEBUG_LOG_FILE ${TUI_DEBUG:+QWEN_DEBUG_LOG_FILE=1} HOME=$SC/userhome QWEN_HOME=$SC/home QWEN_RUNTIME_DIR=$SC/runtime \
   OPENAI_API_KEY=mock-key OPENAI_BASE_URL=http://127.0.0.1:$MOCK_PORT/v1 OPENAI_MODEL=mock-model TERM=xterm-256color \
   node $CLI $* ; echo EXITED; sleep 600"
echo "started $ARM in tmux -L $TSOCK session $S"
