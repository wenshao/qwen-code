#!/bin/bash
# inside VM: Flyway startup of the PR head e50e2c37 jar: fresh DB, and a DB first migrated by main 3f56f74a.
set -u
RIG=/Users/wenshao/pr13138-rig
q() { docker exec w0e3-db mysql -uroot -prootpw -N -e "$1" 2>/dev/null; }
hist() { q "SELECT CONCAT(version,':',description) FROM $1.flyway_schema_history WHERE CAST(version AS UNSIGNED) >= 26 ORDER BY installed_rank" | paste -sd ' ' -; }
fresh() { bash $RIG/vm/reset.sh $1 JAR=$2 DIST=dist-e50 VERIFIED=false PUB=0 HOOKS=0 MCP=0 > /dev/null 2>&1; }
st() { local r; r=$(bash $RIG/vm/svc.sh JAR=$3 DB=$2 restart 2>&1 | tail -1 | cut -c1-12); echo "== $1: $3 -> $(systemctl is-active qwen-w1b.service) ($r) history=[$(hist $2)]"; bash $RIG/vm/svc.sh stop; }
fresh w1b_e50f1 e50-server.jar; st E1-head-fresh w1b_e50f1 e50-server.jar
fresh w1b_e50f2 mainh2-server.jar; st E2a-main-fresh w1b_e50f2 mainh2-server.jar; st E2b-main-then-head w1b_e50f2 e50-server.jar
