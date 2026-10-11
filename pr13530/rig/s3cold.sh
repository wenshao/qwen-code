#!/bin/bash
# Reviewer plan 3, cold path: restart the Harness, wait out the 60 s writer lease, then load with a changed identity.
set -u; DB=h1; cd /Users/wenshao/git/pr13530-rig
S1=$(python3 -c "import json;print(json.load(open('runs/$DB/ids.json'))['s1'])")
D1=$(python3 -c "import json;print(json.load(open('runs/$DB/ids.json'))['rev1Digest'])")
D2=$(python3 -c "import json;print(json.load(open('runs/$DB/ids.json'))['rev2Digest'])")
sq() { ./mysql.sh sql -N -B $DB -e "$1"; }
hp() { python3 -c "
import json,sys
for l in open('runs/$DB/hproxy.jsonl'):
  o=json.loads(l)
  if o['t']>'$1' and '$S1' in (o.get('path','')+json.dumps(o.get('req') or {})):
    print('   hproxy', o['t'][11:23], o['m'], o['path'][:60], o['status'], json.dumps((o.get('req') or {}).get('agentDefinition')), (o.get('body') or '')[:160])"; }
springrestart() { node stack.mjs spring $DB >/dev/null; for i in $(seq 120); do curl -s -o /dev/null -w '%{http_code}' --noproxy '*' http://127.0.0.1:18530/actuator/health | grep -q 200 && break; sleep 1; done; }
cold() { node stack.mjs harness $DB >/dev/null; echo "   $(date -u +%T) harness restarted; waiting 70 s for the old writer lease"; sleep 70; springrestart; }
step() { local label=$1 id=$2; local T=$(date -u +%Y-%m-%dT%H:%M:%S); echo "== $label"; WAIT=${3:-90} node scen.mjs $DB text $S1 $id; hp $T; }
echo "active turns: $(sq "SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='$S1' AND status NOT IN ('COMPLETED','FAILED','CANCELLED')")"
sq "UPDATE managed_agent_session SET agent_definition_digest='$D2' WHERE session_id='$S1'"
cold; step "B1 changed digest, cold" s3B1$RANDOM
sq "UPDATE managed_agent_session SET agent_definition_digest='$D1' WHERE session_id='$S1'"
springrestart; step "B2 original identity restored" s3B2$RANDOM
sq "UPDATE managed_agent_session SET agent_revision='2' WHERE session_id='$S1'"
cold; step "C1 changed revision, cold" s3C1$RANDOM
sq "UPDATE managed_agent_session SET agent_revision='1' WHERE session_id='$S1'"
springrestart; step "C2 restored" s3C2$RANDOM
echo "final row: $(sq "SELECT agent_revision, agent_definition_digest, status FROM managed_agent_session WHERE session_id='$S1'")"
