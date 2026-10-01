#!/bin/bash
# inside VM: stop the service, kill this rig's workers/harnesses by exact PID, drop the DB, recreate Workspace roots.
# usage: reset.sh <db> [KEY=VALUE ...]   (the service is left stopped)
set -u
DB=$1; shift
bash /Users/wenshao/pr13138-rig/vm/svc.sh stop
for p in $(pgrep -x node || true); do
  c=$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null) || continue
  case "$c" in *"/opt/w1b/"*"managed-runtime-worker"*|*"/opt/w1b/"*"serve --profile hosted-harness"*) kill -9 $p 2>/dev/null && echo "killed leftover node $p";; esac
done
NEWDB=$DB; . /etc/qwen-w1b.env; DB=$NEWDB
if [ "${DBCONT:-w0e3-db}" = w0e3-mariadb ]; then docker exec w0e3-mariadb mariadb -uroot -p${DBPASS} -e "DROP DATABASE IF EXISTS $DB" 2>/dev/null; else docker exec w0e3-db mysql -uroot -prootpw -e "DROP DATABASE IF EXISTS $DB" 2>/dev/null; fi
sudo rm -rf /var/lib/qwen-w1b/$DB /var/lib/qwen-w1b/home-$DB
# The non-durable provisioner needs its state directory to exist (the durable one creates it).
mkdir -p /var/lib/qwen-w1b/$DB && chmod 700 /var/lib/qwen-w1b/$DB
bash /Users/wenshao/pr13138-rig/vm/svc.sh DB=$DB "$@" > /dev/null
. /etc/qwen-w1b.env
sudo rm -rf ${ROOTBASE:-/srv/w1b}/* ; 
for st in $STORAGES; do mkdir -p ${ROOTBASE:-/srv/w1b}/$st/project; done
# c21efbdf refuses a root whose birth time equals its mtime (README: "update the root's mtime offline"); `mkdir -p root/project`
# lands both in one timer tick. NOTOUCH=1 keeps the roots exactly as mkdir left them.
[ "${NOTOUCH:-0}" = 1 ] || { sleep 0.05; for st in $STORAGES; do touch ${ROOTBASE:-/srv/w1b}/$st; done; }
: > /var/log/qwen-w1b/server.log
cat /etc/qwen-w1b.env | tr '\n' ' '; echo
