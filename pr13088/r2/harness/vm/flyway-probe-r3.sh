#!/bin/bash
# inside VM: PR head c21efbdfa1 (W1 migration = V24) against main 78143fe335, whose #13101 added V24__managed_actions.sql.
#   A. what a merge without renumbering would do: the head jar plus main's V24 on the class path (-Dloader.path)
#   B. a database already migrated by main 78143fe335, started with the PR head jar as it is
#   C. the same database started with the local trial merge (W1 migration renumbered to V25)
set -u
cd /rig/vm
COMMON="DIST=dist-head DURABLE=true HARNESS=false PUB=0 MCP=0 VERIFIED=false"
hist() { docker exec w0e3-db mysql -uroot -prootpw -N -B $1 -e "SELECT GROUP_CONCAT(CONCAT('V',version,' ',description) ORDER BY installed_rank SEPARATOR ' | ') FROM flyway_schema_history WHERE installed_rank > 22" 2>/dev/null; }
lines() { grep -a -E "FlywayValidateException|Found more than one migration|Detected resolved migration not applied|Validate failed|Migration checksum mismatch|Migration description mismatch|Migrating schema|Successfully applied|Started ManagedAgentServerApplication|-> Applied to database|-> Resolved locally" /var/log/qwen-w1a/server.log | sed -E 's/^.*(FlywayValidateException|Found more|Detected resolved|Validate failed|Migration checksum|Migration description|Migrating schema|Successfully applied|Started Managed|-> Applied|-> Resolved)/\1/' | awk '!seen[$0]++' | head -8 | cut -c1-230; }
echo "== A. PR head jar + main's V24__managed_actions.sql on the class path (a merge that keeps both V24 files)"
bash reset.sh w1r_fwA JAR=head-server.jar $COMMON > /dev/null
out=$(bash svc.sh LOADER_EXTRA=/rig/flyway-probe/v24dup start 2>&1 | head -1 | cut -c1-60); echo "   start: $out"; lines | sed 's/^/   /'; bash svc.sh LOADER_EXTRA= stop
echo "== B. database migrated by main 78143fe335, then the PR head jar c21efbdfa1"
bash reset.sh w1r_fwB JAR=base3-server.jar DIST=dist-base DURABLE=true HARNESS=false PUB=0 MCP=0 VERIFIED=absent > /dev/null
out=$(bash svc.sh start 2>&1 | head -1 | cut -c1-40); echo "   main: $out; history: ... $(hist w1r_fwB)"; bash svc.sh stop
: > /var/log/qwen-w1a/server.log
out=$(bash svc.sh JAR=head-server.jar DIST=dist-head VERIFIED=false start 2>&1 | head -1 | cut -c1-60); echo "   PR head on that database: $out"; lines | sed 's/^/   /'; bash svc.sh stop
echo "   history: ... $(hist w1r_fwB)"
echo "== C. the same database, trial merge (W1 migration = V25)"
: > /var/log/qwen-w1a/server.log
out=$(bash svc.sh JAR=m3-server.jar DIST=dist-head VERIFIED=false start 2>&1 | head -1 | cut -c1-40); echo "   trial merge: $out"; lines | sed 's/^/   /'; bash svc.sh stop
echo "   history: ... $(hist w1r_fwB)"
bash svc.sh JAR=head-server.jar LOADER_EXTRA= > /dev/null
echo FLYWAY-R3-DONE
