#!/bin/bash
# R2-3: a database migrated through main's V64 upgrades to the PR (V66) and keeps working.
set -u; DB=m1; cd /Users/wenshao/git/pr13530-rig
sq() { ./mysql.sh sql -N -B $DB -e "$1"; }
node stack.mjs stop $DB spring; node stack.mjs stop $DB harness
python3 - <<'PY'
import json
p='runs/m1/state.json'; s=json.load(open(p))
s['arm']='head-upgraded'; s['wt']='/Users/wenshao/git/pr13530-head'; s['cli']=s['wt']+'/dist/cli.js'
s['jar']=s['wt']+'/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar'
json.dump(s,open(p,'w'),indent=2)
PY
echo "before: $(sq "SELECT GROUP_CONCAT(version ORDER BY installed_rank DESC SEPARATOR ',') FROM (SELECT version, installed_rank FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 3) x")"
node stack.mjs spring $DB >/dev/null
for i in $(seq 150); do curl -s -o /dev/null -w '%{http_code}' --noproxy '*' http://127.0.0.1:18540/actuator/health | grep -q 200 && { echo "spring (head jar) up ${i}s"; break; }; sleep 1; done
echo "after: $(sq "SELECT CONCAT(version,' ',script,' success=',success) FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 1")"
echo "column: $(sq "SELECT CONCAT(COLUMN_NAME,' ',COLUMN_TYPE,' nullable=',IS_NULLABLE) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DB' AND TABLE_NAME='managed_agent_session' AND COLUMN_NAME='agent_definition_digest'")"
echo "legacy rows with NULL digest: $(sq "SELECT COUNT(*) FROM managed_agent_session WHERE agent_definition_digest IS NULL")"
node stack.mjs harness $DB >/dev/null; echo "harness (head) restarted $(date -u +%T); waiting 70 s for the main Harness writer lease"; sleep 70
echo "== old qwen-code bound Session"; WAIT=90 node scen.mjs $DB text c0710ac7-8127-4519-a8f3-b4315cdc4e4e upq$RANDOM
echo "== legacy unbound Session created on main from a stored agent id"; WAIT=90 node scen.mjs $DB text a34ed007-189c-409a-a3c6-f9b0453ed95b upl$RANDOM
node -e "
import('./lib.mjs').then(async ({client})=>{const c=client('m1'); const g=await c.get('a34ed007-189c-409a-a3c6-f9b0453ed95b'); console.log('   legacy GET', g.status, g.json.agent_id, g.json.agent_revision, 'agent_digest' in g.json ? g.json.agent_digest : '(absent)');});"
echo "== new Session from the definition stored on main (model-b + instructions, tools [])"
WAIT=90 node scen.mjs $DB newtext agent_582b7adaf7b14a938c2a273a083a2d1c upn$RANDOM
