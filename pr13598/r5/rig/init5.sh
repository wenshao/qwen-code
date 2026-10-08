#!/bin/bash
# usage: init5.sh <db> <basePort> [cli]   — head jar; dist/cli.js from head unless cli given
set -u
cd /Users/wenshao/git/pr13598-rig
DB=$1; B=$2; CLIP=${3:-}
for p in $(seq $B $((B+6))); do lsof -nP -iTCP:$p -sTCP:LISTEN -t >/dev/null 2>&1 && { echo "busy $p"; exit 1; }; done
if [ -n "$CLIP" ]; then CLI=$CLIP node stack.mjs init head $DB $B $((B+1)) $((B+2)) $((B+3)) $((B+4)) || exit 1
else node stack.mjs init head $DB $B $((B+1)) $((B+2)) $((B+3)) $((B+4)) || exit 1; fi
node stack.mjs btap $DB $((B+5)) || exit 1
node -e 'const f="runs/'$DB'/state.json";const s=JSON.parse(require("fs").readFileSync(f));s.modelUrl="http://127.0.0.1:35986/v1";require("fs").writeFileSync(f,JSON.stringify(s,null,2));console.log(s.cli, s.modelUrl)'
for i in $(seq 180); do curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$B/actuator/health 2>/dev/null | grep -q 200 && break; sleep 1; done
./setup-db.sh $DB | tail -1
node stack.mjs harness $DB
for i in $(seq 60); do curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$((B+1))/health 2>/dev/null | grep -q 401 && break; sleep 1; done
mkdir -p runs/$DB/workspace-mount/notes && printf 'BEACON-%s-%s\nsecond line\n' $DB $RANDOM > runs/$DB/workspace-mount/notes/status.txt
echo "INIT-DONE $DB $(date -u +%T)"
