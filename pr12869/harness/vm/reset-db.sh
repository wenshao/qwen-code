#!/bin/bash
# usage: reset-db.sh <db> <trusted:true|false> [storages]   (inside the VM; stops by unit and by exact PID only)
set -eu
DB=$1; TRUSTED=$2; STORAGES=${3:-a b c d}
sudo systemctl stop qwen-w0e3.service || true
for pid in $(pgrep -x node || true); do
  if tr '\0' ' ' < /proc/$pid/cmdline | grep -q "/opt/qwen/dist/cli.js managed-runtime-worker\|/opt/qwen/rig/"; then kill -9 $pid || true; fi
done
sudo sed -i "s/^DB=.*/DB=$DB/; s/^TRUSTED=.*/TRUSTED=$TRUSTED/; s/^STORAGES=.*/STORAGES=\"$STORAGES\"/" /etc/qwen-w0e3.env
sudo rm -rf /srv/ws/*; sudo mkdir -p /srv/ws; sudo chown wenshao:wenshao /srv/ws
: > /var/log/qwen-w0e3/server.log
sudo systemctl reset-failed qwen-w0e3.service || true
sudo systemctl start qwen-w0e3.service
for i in $(seq 1 60); do [ "$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/actuator/health 2>/dev/null)" = 200 ] && break; sleep 1; done
curl -s --noproxy '*' http://127.0.0.1:8080/actuator/health; echo
cat /etc/qwen-w0e3.env
ps -eo pid,ppid,args | grep -E "cli.js managed-runtime|server.jar|/opt/qwen/rig" | grep -v grep | cut -c1-120 || true
