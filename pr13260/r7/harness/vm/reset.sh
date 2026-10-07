#!/bin/bash
# inside VM: stop the service, kill this rig's workers/harnesses by exact PID, drop the DB, recreate Workspace roots
# on the SOURCE filesystem and empty the target filesystems.  usage: reset.sh <db> [KEY=VALUE ...]   (service left stopped)
set -u
DB=$1; shift
bash /Users/wenshao/pr13260-rig/vm/svc.sh stop
for p in $(pgrep -x node || true); do
  c=$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null) || continue
  case "$c" in *"/opt/w1c/"*"managed-runtime-worker"*|*"/opt/w1c/"*"serve --profile hosted-harness"*) kill -9 $p 2>/dev/null && echo "killed leftover node $p";; esac
done
docker exec w0e3-db mysql -uroot -prootpw -e "DROP DATABASE IF EXISTS $DB" 2>/dev/null
sudo rm -rf /var/lib/qwen-w1c/$DB /var/lib/qwen-w1c/home-$DB
mkdir -p /var/lib/qwen-w1c/$DB && chmod 700 /var/lib/qwen-w1c/$DB
bash /Users/wenshao/pr13260-rig/vm/svc.sh DB=$DB ROOTBASE=/srv/w1c-src ROOT_a= ROOT_b= ROOT_c= ROOT_d= QHOME=default "$@" > /dev/null
. /etc/qwen-w1c.env
for fs in /srv/w1c-src /srv/w1c-dst /srv/w1c-mr; do sudo find $fs -mindepth 1 -maxdepth 1 ! -name lost+found -exec rm -rf {} +; done
for st in $STORAGES; do mkdir -p $ROOTBASE/$st/project; done
[ "${NOTOUCH:-0}" = 1 ] || { sleep 0.05; for st in $STORAGES; do touch $ROOTBASE/$st; done; }
: > /var/log/qwen-w1c/server.log
cat /etc/qwen-w1c.env | tr '\n' ' '; echo
