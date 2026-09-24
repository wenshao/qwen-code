#!/bin/bash
# run1.sh <arm> <family> <task> <rep>
# Real ~/.qwen config (no copied credentials), approval mode forced to default,
# auto-approval limited to read-only tools, file edits and the fixture's npm scripts.
R=/Users/wenshao/git/v12546; arm=$1; fam=$2; task=$3; rep=$4
case $fam in
  kimi) M=(-m kimi-k3) ;;
  deepseek) M=(--auth-type openai -m deepseek-v4.1-flash) ;;
esac
d=$R/runs/$fam/$task/$arm-$rep; rm -rf $d; mkdir -p $d/rt; cp -R $R/fixture $d/ws
prompt=$(cat $R/harness/tasks/$task.txt)
cd $d/ws && env QWEN_RUNTIME_DIR=$d/rt QWEN_CODE_SUPPRESS_YOLO_WARNING=1 \
  perl -e 'alarm 600; exec @ARGV' node $R/$arm/dist/cli.js "${M[@]}" --approval-mode default \
  --allowed-tools read_file list_directory glob grep_search edit write_file \
    'run_shell_command(npm test)' 'run_shell_command(npm run lint)' 'run_shell_command(npm run check)' \
  --prompt "$prompt" -o stream-json > $d/out.jsonl 2> $d/err.log
echo "EXIT=$?" > $d/exit
