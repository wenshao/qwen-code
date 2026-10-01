#!/bin/bash
# usage: tui-run.sh <arm> <fixture-dir> [extra args...]  -- runs the TUI with an isolated HOME
arm=$1; F=$2; shift 2
cd $F/ws
exec env -i PATH=/Users/wenshao/.local/state/fnm_multishells/91931_1790854278360/bin:/usr/bin:/bin:/usr/sbin:/sbin HOME=$F/home TERM=xterm-256color LANG=en_US.UTF-8 COLORTERM=truecolor   QWEN_CODE_SYSTEM_SETTINGS_PATH=$F/sys.json QWEN_CODE_SYSTEM_DEFAULTS_PATH=$F/sysdef.json   OPENAI_API_KEY=sk-test OPENAI_BASE_URL=http://127.0.0.1:9 OPENAI_MODEL=fake-model   /Users/wenshao/.local/state/fnm_multishells/91931_1790854278360/bin/node /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/4bc58a7c-2b06-4022-98dd-e3f296888d77/scratchpad/wt-$arm/dist/cli.js "$@"
