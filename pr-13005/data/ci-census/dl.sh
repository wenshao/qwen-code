#!/bin/bash
cd /root/verify/pr13005/ci-census
T=$(gh auth token)
dl() {
  local j=$1
  [ -s logs/$j.log ] && return
  local loc
  loc=$(curl -s -o /dev/null -w '%{redirect_url}' -H "Authorization: token $T" https://api.github.com/repos/QwenLM/qwen-code/actions/jobs/$j/logs)
  [ -n "$loc" ] && curl -s --max-time 1500 -o logs/$j.log.tmp "$loc" && mv logs/$j.log.tmp logs/$j.log
}
n=0
for j in $(cat todo.txt); do
  dl $j &
  n=$((n+1))
  if [ $n -ge 12 ]; then wait -n; n=$((n-1)); fi
done
wait
echo DL_DONE
