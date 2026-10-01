#!/bin/bash
# Alternate arms so endpoint drift hits both equally: base2#0, pr#0, base2#1, ...
OUT=/root/verify/pr13013/out/real-ab.jsonl; : > $OUT
AK=$(jq -r '.env.DASHSCOP_REVIEW_AK' ~/.qwen/settings.json)
for rep in 0 1 2; do
  for arm in base2 pr; do
    H=/root/verify/pr13013/home-real-$arm; rm -rf $H; mkdir -p $H/.qwen
    cd /root/verify/pr13013/$arm
    env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy \
      HOME=$H USERPROFILE=$H CI=true FORCE_COLOR=1 QWEN_SANDBOX=false \
      OPENAI_BASE_URL= OPENAI_MODEL= QWEN_MODEL= DASHSCOPE_API_KEY= \
      AB_ARM=$arm AB_REP=$rep AB_OUT=$OUT AB_KEY="$AK" AB_MODEL=qwen3.8-max \
      AB_UPSTREAM=https://llm-1yxl3y53fm8pcr4z.cn-beijing.maas.aliyuncs.com/compatible-mode/v1 \
      npx vitest run --root ./integration-tests --retry=0 __verify13013__/real-ab \
      > /root/verify/pr13013/out/real-$arm-$rep.ansi 2>&1
    echo "$arm rep=$rep EXIT=$?"
  done
done
