#!/usr/bin/env bash
# Full headless A/B(/C) matrix. base = merge-base ee1ebcc167, head = c2d3c24df8,
# noclamp = head minus the aee22dfbfd clamp (== 8ac6e4d602 shell.ts).
set -uo pipefail
H=/root/git/h11727
cd $H
echo '{"tools":{"truncateToolOutputThreshold":100}}' > ov-t100.json
echo '{"tools":{"truncateToolOutputThreshold":600}}' > ov-t600.json
echo '{"tools":{"truncateToolOutputThreshold":25000}}' > ov-t25k.json
cat > ov-hook.json <<'EOF'
{"hooks":{"PostToolUseFailure":[{"matcher":"run_shell_command","hooks":[{"type":"command","command":"bash /root/git/h11727/hook.sh","name":"ctx","timeout":10}]}]}}
EOF
R=${1:-r1}
for s in s1-ok-window s2-fail-window s3-small s4-far-over s5-timeout-window s5b-timeout-far-over s6-below-gate s7-slow-band s7b-slow-fits s8-slow-oneline-band; do
  for arm in base head; do ./run.sh $arm $s $R-$arm-$s; done
done
for arm in base head; do ./run.sh $arm s2-fail-window $R-$arm-s2-t25k ov-t25k.json; done
for arm in base head; do ./run.sh $arm s2-fail-window $R-$arm-s2-hook ov-hook.json; done
for s in c1-t100-slow-fail c2-t100-slow-ok c3-t100-fast-fail; do
  for arm in base noclamp head; do ./run.sh $arm $s $R-$arm-$s ov-t100.json; done
done
for arm in base noclamp head; do ./run.sh $arm c4-t600-slow-fail $R-$arm-c4-t600-slow-fail ov-t600.json; done
sha256sum /root/git/pr11727/packages/core/dist/src/tools/shell.js | cut -c1-16
