#!/bin/bash
# usage: hwait.sh <db> [maxSeconds]  — wait until the Harness answers /health WITH its bearer token
# (the Harness runs --require-auth, so an unauthenticated /health never answers 200).
cd /Users/wenshao/git/pr13572-rig || exit 9
TOKEN=$(node -e "console.log(require('./runs/$1/state.json').harnessToken)")
for i in $(seq $(( ${2:-120} * 5 ))); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' -H "Authorization: Bearer $TOKEN" http://127.0.0.1:35721/health)" = 200 ] && { date -u +%T.%N | cut -c1-12; exit 0; }
  sleep 0.2
done
echo TIMEOUT; exit 1
