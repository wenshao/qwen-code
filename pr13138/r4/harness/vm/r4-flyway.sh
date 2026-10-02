#!/bin/bash
# inside VM: Flyway startup of head d8bc703e (V31 W1b): fresh, upgrade from main d5c22d33, and a DB built by the
# round-3 head e50e2c37 (its V28 was the W1b migration).
set -u
RIG=/Users/wenshao/pr13138-rig
q() { docker exec w0e3-db mysql -uroot -prootpw -N -e "$1" 2>/dev/null; }
hist() { q "SELECT CONCAT(version,':',description) FROM $1.flyway_schema_history WHERE CAST(version AS UNSIGNED) >= 27 ORDER BY installed_rank" | paste -sd ' ' -; }
fresh() { bash $RIG/vm/reset.sh $1 JAR=$2 DIST=dist-e50 VERIFIED=false PUB=0 HOOKS=0 MCP=0 > /dev/null 2>&1; }
st() { : > /var/log/qwen-w1b/server.log; local r; r=$(bash $RIG/vm/svc.sh JAR=$3 DB=$2 restart 2>&1 | tail -1 | cut -c1-12); echo "== $1: $3 -> $(systemctl is-active qwen-w1b.service) ($r) history=[$(hist $2)]"; grep -a -o -E "Found more than one migration[^\"]*|Migration (checksum|description) mismatch for migration version [0-9]+|Successfully validated [0-9]+ migrations|now at version v[0-9]+" /var/log/qwen-w1b/server.log | sort -u | sed 's/^/   | /'; cp /var/log/qwen-w1b/server.log $RIG/out/e2e-r4/flyway-$1.log; bash $RIG/vm/svc.sh stop; }
mkdir -p $RIG/out/e2e-r4
fresh w1b_r4f1 d8b-server.jar; st H1-head-fresh w1b_r4f1 d8b-server.jar
fresh w1b_r4f2 main4-server.jar; st H2a-main-fresh w1b_r4f2 main4-server.jar; st H2b-main-then-head w1b_r4f2 d8b-server.jar
fresh w1b_r4f3 e50-server.jar; st H3a-e50-fresh w1b_r4f3 e50-server.jar; st H3b-e50-then-head w1b_r4f3 d8b-server.jar
