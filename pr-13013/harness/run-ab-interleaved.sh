#!/bin/bash
# usage: run-ab-interleaved.sh <latencyMs> <rounds>; each round runs base2 then pr (or pr then base2 on odd rounds), REPS=1
L=$1; N=$2
OUT=/root/verify/pr13013/out/abi-L${L}.jsonl; : > $OUT
for i in $(seq 0 $((N-1))); do
  if [ $((i % 2)) -eq 0 ]; then arms="base2 pr"; else arms="pr base2"; fi
  for arm in $arms; do
    cd /root/verify/pr13013/$arm
    env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy \
      CI=true FORCE_COLOR=1 QWEN_SANDBOX=false AB_ARM=$arm AB_LATENCY_MS=$L AB_REPS=1 AB_OUT=$OUT \
      npx vitest run --root ./integration-tests --retry=0 __verify13013__/memory-ab > /root/verify/pr13013/out/abi-L${L}-$arm-$i.ansi 2>&1
    echo "round $i $arm EXIT=$? load=$(cut -d' ' -f1 /proc/loadavg)"
  done
done
