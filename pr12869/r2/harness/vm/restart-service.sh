#!/bin/bash
# usage: restart-service.sh <trusted:true|false> [jar]   (same boot; workers survive: KillMode=process)
set -eu
sudo sed -i "s/^TRUSTED=.*/TRUSTED=$1/; s/^JAR=.*/JAR=${2:-server.jar}/" /etc/qwen-w0e3.env
sudo systemctl stop qwen-w0e3.service || true
sudo systemctl reset-failed qwen-w0e3.service || true
sudo systemctl start qwen-w0e3.service
for i in $(seq 1 90); do [ "$(curl -s --noproxy '*' -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/actuator/health 2>/dev/null)" = 200 ] && break; sleep 1; done
grep -a "=== " /var/log/qwen-w0e3/server.log | tail -1
