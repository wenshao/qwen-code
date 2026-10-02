#!/bin/bash
# Real OSS gate. The delete-denied identity could not be created (RAM user lacks ram:CreateUser), so the
# OSS_DELETE_DENIED_* variables carry the SAME normal identity: the permission case is expected to fail.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9d84bca0-c4ea-4895-80e3-553468b6983a/scratchpad
ID=$(awk '$1=="accessKeyId"{print $2}' ~/Aliyun/README.md); SEC=$(awk '$1=="accessKeySecret"{print $2}' ~/Aliyun/README.md)
[ -n "$ID" ] && [ -n "$SEC" ] || { echo "no credentials"; exit 2; }
export OSS_ACCESS_KEY_ID=$ID OSS_ACCESS_KEY_SECRET=$SEC OSS_DELETE_DENIED_ACCESS_KEY_ID=$ID OSS_DELETE_DENIED_ACCESS_KEY_SECRET=$SEC
export JAVA_TOOL_OPTIONS="-Dhttps.proxyHost= -Dhttp.proxyHost= -DsocksProxyHost= -Dhttp.nonProxyHosts=*"
exec $S/rig/o4gate.sh "$@"
