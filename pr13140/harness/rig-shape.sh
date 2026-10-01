#!/bin/sh
# Run as uid 1000: bwrap policy in User settings; probe, one command, verify.
H=/home/node; mkdir -p $H/.qwen $H/ws
for backend in bwrap auto; do
cat > $H/.qwen/settings.json <<J
{"tools":{"executionSandbox":{"backend":"$backend","filesystem":"workspace-write","network":"closed"}}}
J
for inst in base-local base-rel head-local head-rel; do
  Q="node /opt/$inst/lib/node_modules/@qwen-code/qwen-code/cli-entry.js"
  cd $H/ws
  out=$($Q sandbox -- sh -c 'echo payload-ran uid=$(id -u)' 2>&1); rc=$?
  echo "[$backend] $inst run   exit=$rc :: $(echo "$out" | tr '\n' '|' | cut -c1-330)"
  out=$($Q sandbox --verify 2>&1); rc=$?
  echo "[$backend] $inst verify exit=$rc :: $(echo "$out" | tail -2 | tr '\n' '|' | cut -c1-260)"
done
done
