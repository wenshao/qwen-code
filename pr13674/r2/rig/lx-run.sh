#!/bin/bash
# usage: lx-run.sh <phase> <arm> <db> [extra env...]  -- runs rig.mjs inside the Linux app container (durable local-process)
P=$1; A=$2; D=$3; shift 3
docker --context colima-pr13674 exec "$@" -e RIG_DIR=/work -e RIG_JAR=/Users/wenshao/pr13674-rig/server/$A-server.jar \
  -e RIG_CLI=${LX_CLI:-/Users/wenshao/pr13674-rig/src-merge/dist/cli.js} -e RIG_MYSQL=mysql -e RIG_JAVA=java -e RIG_DBPW=rigpw -e RIG_DBPORT=3306 \
  -e RIG_DURABLE=true pr13674-app sh -c "cd /work && node rig.mjs $P $A $D"
