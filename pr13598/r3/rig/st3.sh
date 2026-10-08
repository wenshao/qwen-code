#!/bin/bash
# usage: st3.sh <db> <since> <name>...  — Spring->Harness timeline + DB dump per Session
cd /Users/wenshao/git/pr13598-rig; db=$1; since=$2; shift 2
for n in "$@"; do echo "=== $n $(cat runs/$db/$n)"; node tapsum.mjs $db $(cat runs/$db/$n) $since; node client.mjs $db dump $(cat runs/$db/$n) | grep -v -E '^--- (automation schedule)'; done 2>&1 | cut -c1-240
