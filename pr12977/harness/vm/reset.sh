#!/bin/bash
# inside VM: kill this rig's escaped writers by exact PID, then the old rig's reset (service + workers + DB + Workspaces)
# usage: reset.sh <db> <trusted> [jar]
set -u
for p in $(pgrep -x sh || true); do
  c=$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null) || continue
  case "$c" in "sh -c i=0; while :;"*) echo "kill escaped writer $p"; kill -9 $p;; esac
done
for p in $(pgrep -x node || true); do
  c=$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null) || continue
  case "$c" in *"serve --profile hosted-harness"*) echo "kill leftover harness $p"; kill -9 $p;; esac
done
sudo systemctl stop qwen-w0e3.service || true
docker exec w0e3-db mysql -uroot -prootpw -e "DROP DATABASE IF EXISTS $1" 2>/dev/null
sudo rm -rf /var/lib/qwen-rt/$1
sudo sed -i "s/^JAR=.*/JAR=${3:-pr12977-server.jar}/" /etc/qwen-w0e3.env
bash /opt/qwen/reset-db.sh "$1" "$2" "a b c d" 2>&1 | tail -3
