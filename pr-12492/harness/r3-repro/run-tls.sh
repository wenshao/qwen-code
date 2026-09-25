#!/bin/bash
# Like run-one.sh, but also bind-mounts tls/hosts over /etc/hosts inside the
# private mount namespace so dashscope.aliyuncs.com resolves to 127.0.0.1
# (the machine's real /etc/hosts is untouched; no real network exists here).
set -u
script="$1"
cd /root/verify/pr12492/r3-repro
exec env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy -u NO_PROXY -u no_proxy \
  unshare -mn bash -c 'ip link set lo up; mount --bind /root/verify/pr12492/r3-repro/tls/hosts /etc/hosts; node -e "require(\"dns\").lookup(\"dashscope.aliyuncs.com\",{all:true},(e,a)=>console.log(\"node dns.lookup:\",JSON.stringify(a)))"; node "$0"' "$script" 2>&1 | tee "logs/${script%.mjs}${LOGSUFFIX:-}.log"
