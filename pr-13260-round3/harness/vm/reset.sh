#!/bin/bash
# x86_64 rig: stop the service, kill this rig's workers/harnesses by exact PID, drop the DB, recreate Workspace roots
# on the SOURCE filesystem and empty the target filesystems.  usage: reset.sh <db> [KEY=VALUE ...]   (service left stopped)
set -u
DB=$1; shift
bash /root/verify/pr13260/rig/vm/svc.sh stop
for p in $(pgrep -x node || true); do
  c=$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null) || continue
  case "$c" in *"/opt/pr13260/"*"managed-runtime-worker"*|*"/opt/pr13260/"*"serve --profile hosted-harness"*) kill -9 $p 2>/dev/null && echo "killed leftover node $p";; esac
done
docker exec pr13260-mysql mysql -uroot -prootpw -e "DROP DATABASE IF EXISTS $DB" 2>/dev/null
rm -rf /var/lib/pr13260/$DB /var/lib/pr13260/home-$DB
runuser -u w1crig -- bash -c "mkdir -p /var/lib/pr13260/$DB && chmod 700 /var/lib/pr13260/$DB"
bash /root/verify/pr13260/rig/vm/svc.sh DB=$DB ROOTBASE=/srv/pr13260/src ROOT_a= ROOT_b= QHOME=default "$@" > /dev/null
. /opt/pr13260/rig.env
for fs in /srv/pr13260/src /srv/pr13260/dst /srv/pr13260/mr; do find $fs -mindepth 1 -maxdepth 1 ! -name lost+found -exec rm -rf {} +; done
for st in $STORAGES; do runuser -u w1crig -- mkdir -p $ROOTBASE/$st/project; done
[ "${NOTOUCH:-0}" = 1 ] || { sleep 0.05; for st in $STORAGES; do runuser -u w1crig -- touch $ROOTBASE/$st; done; }
: > /var/lib/pr13260/log/server.log; chown w1crig:w1crig /var/lib/pr13260/log/server.log
cat /opt/pr13260/rig.env | tr '\n' ' '; echo
