#!/bin/bash
# inside VM: stop the service, kill this rig's workers/harnesses by exact PID, drop the DB, recreate Workspace roots.
# usage: reset.sh <db> [KEY=VALUE ...]   (the service is left stopped)
set -u
DB=$1; shift
bash /rig/vm/svc.sh stop
for p in $(pgrep -x node || true); do
  c=$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null) || continue
  case "$c" in *"/opt/w1a/"*"managed-runtime-worker"*|*"/opt/w1a/"*"serve --profile hosted-harness"*) kill -9 $p 2>/dev/null && echo "killed leftover node $p";; esac
done
NEWDB=$DB; . /etc/qwen-w1a.env; DB=$NEWDB
if [ "${DBCONT:-w0e3-db}" = w0e3-mariadb ]; then docker exec w0e3-mariadb mariadb -uroot -p${DBPASS} -e "DROP DATABASE IF EXISTS $DB" 2>/dev/null; else docker exec w0e3-db mysql -uroot -prootpw -e "DROP DATABASE IF EXISTS $DB" 2>/dev/null; fi
sudo rm -rf /var/lib/qwen-w1a/$DB
# The non-durable provisioner needs its state directory to exist (the durable one creates it).
mkdir -p /var/lib/qwen-w1a/$DB && chmod 700 /var/lib/qwen-w1a/$DB
bash /rig/vm/svc.sh DB=$DB "$@" > /dev/null
. /etc/qwen-w1a.env
sudo rm -rf ${ROOTBASE:-/srv/w1a}/* ; 
for st in $STORAGES; do mkdir -p ${ROOTBASE:-/srv/w1a}/$st/project; done
: > /var/log/qwen-w1a/server.log
cat /etc/qwen-w1a.env | tr '\n' ' '; echo
