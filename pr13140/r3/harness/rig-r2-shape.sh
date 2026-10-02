#!/bin/bash
# R2, uid 1000: install shapes (no stdin redirect) + host-backed stdin per shape.
H=/home/node; mkdir -p $H/.qwen $H/ws; cd $H/ws
echo filedata > $H/f.txt
for backend in bwrap auto; do
  echo "{\"tools\":{\"executionSandbox\":{\"backend\":\"$backend\",\"filesystem\":\"workspace-write\",\"network\":\"closed\"}}}" > $H/.qwen/settings.json
  for inst in base-rel head-local head-rel; do
    Q="node /opt/$inst/lib/node_modules/@qwen-code/qwen-code/cli-entry.js"
    out=$($Q sandbox -- sh -c 'echo payload-ran uid=$(id -u)' </dev/null 2>&1); rc=$?
    echo "[$backend] $inst run(/dev/null) exit=$rc :: $(echo "$out" | grep -v -E '^(Filesystem|Command network|Model,|Host reads)' | tr '\n' '|' | cut -c1-230)"
    out=$($Q sandbox --verify 2>&1); rc=$?
    echo "[$backend] $inst verify exit=$rc :: $(echo "$out" | tail -1 | cut -c1-200)"
    out=$(echo piped | $Q sandbox -- cat 2>&1); rc=$?
    echo "[$backend] $inst pipe-stdin exit=$rc :: $(echo "$out" | tail -1 | cut -c1-200)"
    out=$($Q sandbox -- cat < $H/f.txt 2>&1); rc=$?
    echo "[$backend] $inst file-stdin exit=$rc :: $(echo "$out" | grep -v -E '^(Boundary|Filesystem|Command network|Model,|Host reads|Backend probe)' | tr '\n' '|' | cut -c1-260)"
  done
done
for inst in base-rel head-rel; do
  stat -c "$inst helper after: %U %a" /opt/$inst/lib/node_modules/@qwen-code/qwen-code/vendor/landlock-run/arm64-linux/qwen-landlock-run
done
