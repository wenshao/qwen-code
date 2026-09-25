#!/bin/bash
# run1.sh <arm> <task> <rep> — real bundle, isolated QWEN_HOME (qwen3.8-max via logging proxy), default approval,
# auto-approval limited to read-only tools, edits and the fixture's npm scripts. Wire bodies moved into the run dir.
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/50c97716-7195-475a-a8de-b9dfb77ea084/scratchpad/r4
R=/Users/wenshao/git/v12546; arm=$1; task=$2; rep=$3
d=$SP/runs/$task/$arm-$rep; rm -rf $d; mkdir -p $d/rt $d/wire; cp -R $R/fixture $d/ws
prompt=$(cat $SP/harness/tasks/$task.txt); mkdir -p $SP/wire; rm -f $SP/wire/*
cd $d/ws && env QWEN_HOME=$SP/qhome QWEN_RUNTIME_DIR=$d/rt perl -e 'alarm 600; exec @ARGV' node $R/$arm/dist/cli.js -m qwen3.8-max --approval-mode default \
  --allowed-tools read_file list_directory glob grep_search edit write_file \
    'run_shell_command(npm test)' 'run_shell_command(npm run lint)' 'run_shell_command(npm run check)' \
  --prompt "$prompt" -o stream-json > $d/out.jsonl 2> $d/err.log
echo "EXIT=$?" > $d/exit; mv $SP/wire/* $d/wire/ 2>/dev/null; true
