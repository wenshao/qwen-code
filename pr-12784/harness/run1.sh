#!/bin/bash
# run1.sh <arm> <model> <task> <rep> <todo:0|1>
# Real bundle (dist/cli.js of the arm), isolated per-run QWEN_HOME whose only provider
# points at the logging proxy (which injects the real key). Default approval; auto-approval
# limited to read-only tools, edits, todo_write and the fixture's npm scripts.
V=/Users/wenshao/git/v12784; arm=$1; model=$2; task=$3; rep=$4; todo=$5
short=${model%%-*}; short=${short%%.*}
id=$task-$short-$arm-t$todo-$rep
d=$V/runs/$id; rm -rf $d; mkdir -p $d/rt $d/home; cp -R $V/fixture $d/ws
todoBool=$([ "$todo" = 1 ] && echo true || echo false)
cat > $d/home/settings.json <<JSON
{
  "security": { "auth": { "selectedType": "openai" } },
  "model": { "name": "$model" },
  "modelProviders": { "openai": [
    { "id": "$model", "name": "$model via proxy", "baseUrl": "http://127.0.0.1:18784/$id/v1",
      "envKey": "PROXY_AK", "generationConfig": { "extra_body": { "enable_thinking": true } } }
  ] },
  "env": { "PROXY_AK": "injected-by-proxy" },
  "tools": { "approvalMode": "default", "todoWrite": { "enabled": $todoBool } },
  "general": { "disableAutoUpdate": true },
  "privacy": { "usageStatisticsEnabled": false }
}
JSON
prompt=$(cat $V/harness/tasks/$task.txt)
cd $d/ws && env -i HOME=$HOME PATH=$PATH TERM=xterm-256color LANG=en_US.UTF-8 \
  QWEN_HOME=$d/home QWEN_RUNTIME_DIR=$d/rt QWEN_CODE_SUPPRESS_YOLO_WARNING=1 \
  perl -e 'alarm 900; exec @ARGV' node $V/$arm/dist/cli.js -m "$model" --approval-mode default \
  --allowed-tools read_file list_directory glob grep_search edit write_file todo_write \
    'run_shell_command(npm test)' 'run_shell_command(npm run lint)' 'run_shell_command(npm run check)' \
  --prompt "$prompt" -o stream-json > $d/out.jsonl 2> $d/err.log
echo "EXIT=$?" > $d/exit
git -C $d/ws diff > $d/ws.diff
