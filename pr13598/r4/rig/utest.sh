#!/bin/bash
# usage: utest.sh <db>  — user Turn cancelled / failed, then a follow-up asking for what the earlier prompt said
cd /Users/wenshao/git/pr13598-rig; DB=$1; L=runs/$DB/u-test.log; source mk4.sh
tid(){ node -e 'const j=JSON.parse(require("fs").readFileSync(0));console.log(j.json.turn_id ?? ("ERR "+j.status+" "+JSON.stringify(j.json).slice(0,200)))'; }
waitturn(){ for i in $(seq 120); do s=$(./mysql.sh sql -N -B -e "select status from managed_agent_turn where turn_id='$1'" $DB); case "$s" in COMPLETED|FAILED|CANCELLED|CANCELED|INTERRUPTED) echo "$s"; return;; esac; sleep 1; done; echo "TIMEOUT($s)"; }
log(){ echo "$(date -u +%T) $*" >> $L; }
mks $DB U1 2>/dev/null; mks $DB U2 2>/dev/null; sleep 12
U1=$(cat runs/$DB/U1); U2=$(cat runs/$DB/U2)
T=$(node client.mjs $DB send $U1 "USER::u1-cancel HOLD1::u1c$DB::60 My locker code is 4711. Remember it and reply with exactly: NOTED" | tid); log "U1 turn $T sent (held 60 s at the gateway)"
sleep 10
node client.mjs $DB raw POST /v1/agents/sessions/$U1/events "{\"type\":\"agent.session.cancel\",\"turn_id\":\"$T\"}" | node -e 'const j=JSON.parse(require("fs").readFileSync(0));console.log(j.status, JSON.stringify(j.json).slice(0,160))' | while read l; do log "cancel -> $l"; done
log "U1 turn $T -> $(waitturn $T)"
T2=$(node client.mjs $DB send $U1 "USER::u1-next What is my locker code? If I never told you one, reply with exactly: UNKNOWN" | tid); log "U1 follow-up $T2 sent"
log "U1 follow-up $T2 -> $(waitturn $T2)"
T3=$(node client.mjs $DB send $U2 "USER::u2-fail FAIL1::u2f$DB::400 My locker code is 9090. Remember it and reply with exactly: NOTED" | tid); log "U2 turn $T3 sent (gateway answers 400 once)"
log "U2 turn $T3 -> $(waitturn $T3)"
T4=$(node client.mjs $DB send $U2 "USER::u2-next What is my locker code? If I never told you one, reply with exactly: UNKNOWN" | tid); log "U2 follow-up $T4 sent"
log "U2 follow-up $T4 -> $(waitturn $T4)"
log "DONE"
