#!/bin/bash
# stdin = regular file opened WRITE-ONLY: the bridge's pread fails after bwrap is forked.
H=/home/node; cd $H/ws
echo '{"tools":{"executionSandbox":{"backend":"bwrap","filesystem":"workspace-write","network":"closed"}}}' > $H/.qwen/settings.json
STATE_GLOB="$H/.qwen/tmp/*/sandbox* $H/.qwen/runtime* /tmp/qwen-sandbox-*"
count() { find $H/.qwen /tmp -maxdepth 6 \( -name 'sandbox-control-*' -o -name 'qwen-sandbox-*' \) 2>/dev/null | wc -l; }
for arm in head; do
  for i in 1 2 3 4 5; do
    rm -f $H/ws/side-effect-$arm-$i; : > $H/wo.txt
    before=$(count)
    out=$(node /opt/$arm-local/lib/node_modules/@qwen-code/qwen-code/cli-entry.js sandbox -- sh -c "echo ran > $H/ws/side-effect-$arm-$i; cat >/dev/null; echo cat-rc=\$?" 0>$H/wo.txt 2>&1); rc=$?
    after=$(count)
    echo "$arm#$i exit=$rc payload_side_effect=$([ -f $H/ws/side-effect-$arm-$i ] && echo yes || echo no) leaked_dirs=$((after-before)) :: $(echo "$out" | grep -v -E '^(Boundary|Filesystem|Command network|Model,|Host reads|Backend probe)' | tr '\n' '|' | cut -c1-200)"
  done
done
