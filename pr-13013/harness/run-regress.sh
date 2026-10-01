#!/bin/bash
# Run the same file list on both arms with every model credential blanked.
FILES=$(cat /root/verify/pr13013/out/regress-files.txt | sed 's#^#./#' | tr '\n' ' ')
for arm in base2 pr; do
  H=/root/verify/pr13013/home-$arm; rm -rf $H; mkdir -p $H/.qwen
  cd /root/verify/pr13013/$arm
  start=$(date +%s)
  env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy \
    HOME=$H USERPROFILE=$H CI=true QWEN_SANDBOX=false \
    OPENAI_API_KEY= OPENAI_BASE_URL= OPENAI_MODEL= DASHSCOPE_API_KEY= QWEN_API_KEY= QWEN_MODEL= \
    ANTHROPIC_API_KEY= ANTHROPIC_BASE_URL= GEMINI_API_KEY= QWEN_DEFAULT_AUTH_TYPE= \
    npx vitest run --root ./integration-tests --reporter=json --outputFile=/root/verify/pr13013/out/regress-$arm.json $FILES \
    > /root/verify/pr13013/out/regress-$arm.log 2>&1
  echo "$arm EXIT=$? t=$(( $(date +%s)-start ))s" >> /root/verify/pr13013/out/regress.status
done
echo DONE >> /root/verify/pr13013/out/regress.status
