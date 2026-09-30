#!/bin/bash
# inside VM: set up and run S17 (what changed at 2cbf89313a: FIFO marker, inspect "unavailable", Action resolution as new work).
# usage: s17-run.sh <db>
set -u
cd /rig/vm
DB=$1
sudo systemctl stop w1a-pub 2>/dev/null; sudo systemctl reset-failed w1a-pub 2>/dev/null
bash reset.sh $DB VERIFIED=true JAR=head-server.jar DIST=dist-head DURABLE=true HARNESS=true PUB=0 MCP=0 EXTRA=--qwen.managed-agent.harness.approval-mode=default > /dev/null
J() { W1_JDBC_URL="jdbc:mysql://127.0.0.1:3306/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" W1_JDBC_USER=root W1_JDBC_PASSWORD=rootpw /opt/qwen/jdk/bin/java -cp /opt/w1a/head-server.jar -Dloader.main=com.alibaba.qwen.code.managedagent.store.WorkspaceStorageRegistrationMain org.springframework.boot.loader.launch.PropertiesLauncher "$@" 2>&1 | tail -1; }
bash svc.sh start > /dev/null; bash svc.sh stop
for st in a b c; do echo "register $st: $(J register t-w1a st-$st /srv/w1a/$st $(cat /proc/sys/kernel/random/uuid) --offline-confirmed)"; done
rm -f /var/lib/qwen-w1a/hosted-run/pub-state.json /var/lib/qwen-w1a/hosted-run/pub-up.json
sudo systemd-run --quiet --unit=w1a-pub --uid=$(id -un) --gid=$(id -gn) --working-directory=/rig/vm /opt/qwen/node pub-up.mjs
for i in $(seq 1 60); do [ -f /var/lib/qwen-w1a/hosted-run/pub-state.json ] && curl -s --noproxy '*' -m 2 -o /dev/null http://127.0.0.1:17088/capabilities && break; sleep 1; done
bash svc.sh start
/opt/qwen/node s17-new-head.mjs
sudo systemctl stop w1a-pub
bash svc.sh stop; bash svc.sh EXTRA= HARNESS=false > /dev/null
