#!/bin/bash
# usage: t-dl.sh <label> <session> <artifactId> <sha256/revision>  -> one line: status, bytes, seconds, sha match
R=$(cd $(dirname $0); pwd)
[ -n "$2" ] && [ -n "$3" ] && [ ${#4} -eq 64 ] || { echo "$1: BAD ARGUMENTS"; exit 2; }
OUT=$(curl -s -o $R/run/dl-body -w "status=%{http_code} declared=%header{content-length} received=%{size_download} seconds=%{time_total} curl_exit=%{exitcode}" -H "X-Qwen-Tenant-Id: t-o3" -H "X-Rig-Actor: alice" "http://127.0.0.1:18037/v1/agents/sessions/$2/artifacts/$3/content?revision=$4")
SHA=$(shasum -a 256 $R/run/dl-body | cut -d' ' -f1); rm -f $R/run/dl-body
echo "$1: $OUT sha256_matches=$([ ${#SHA} -eq 64 ] && [ "$SHA" = "$4" ] && echo yes || echo no)"
