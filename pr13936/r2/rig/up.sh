#!/bin/bash
# usage: up.sh <db> <springPort>  — Spring (Flyway) + rig DB setup + Harness + gateway (Spring+10)
DB="$1"; P="$2"; [[ "$P" =~ ^[0-9]+$ && "$DB" =~ ^[a-z0-9]+$ ]] || { echo "bad args"; exit 2; }; cd /Users/wenshao/git/pr13936-rig
node stack.mjs init merge $DB $P $((P+1)) $((P+2)) || exit 1
for i in $(seq 240); do curl -s -o /dev/null -w '%{http_code}' --noproxy '*' http://127.0.0.1:$P/actuator/health | grep -q 200 && { echo "$DB spring up ${i}s"; break; }; sleep 1; done
./setup-db.sh $DB | tail -1 && node stack.mjs harness $DB && sleep 6 && tail -2 runs/$DB/harness.log | cut -c1-200
nohup node gw.mjs $((P+10)) $P $((P+11)) runs/$DB/gw.jsonl > runs/$DB/gw.log 2>&1 &
echo $! > runs/$DB/gw.pid; sleep 1; cat runs/$DB/gw.log
