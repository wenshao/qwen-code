#!/bin/bash
# Run one harness script inside a private network+mount namespace (only `lo`),
# so the CLI cannot reach any real endpoint. Usage: ./run-one.sh r3-01-....mjs
set -u
script="$1"
cd /root/verify/pr12492/r3-repro
exec env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy -u NO_PROXY -u no_proxy \
  unshare -mn bash -c 'ip link set lo up; node "$0"' "$script" 2>&1 | tee "logs/${script%.mjs}${LOGSUFFIX:-}.log"
