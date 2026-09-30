#!/bin/bash
# inside VM: set up storages for S6 and run it.  usage: s6-run.sh <db> <VERIFIED>
set -u
cd /rig/vm
DB=$1; VER=$2
sudo systemctl stop w1a-pub 2>/dev/null; sudo systemctl reset-failed w1a-pub 2>/dev/null
bash reset.sh $DB VERIFIED=$VER JAR=head-server.jar DIST=dist-head DURABLE=true HARNESS=true > /dev/null
J() { W1_JDBC_URL="jdbc:mysql://127.0.0.1:3306/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" W1_JDBC_USER=root W1_JDBC_PASSWORD=rootpw /opt/qwen/jdk/bin/java -cp /opt/w1a/head-server.jar -Dloader.main=com.alibaba.qwen.code.managedagent.store.WorkspaceStorageRegistrationMain org.springframework.boot.loader.launch.PropertiesLauncher "$@" 2>&1 | tail -1; }
# Flyway must create the schema before the maintenance entry can register: start once, stop.
bash svc.sh start > /dev/null; bash svc.sh stop
if [ "$VER" = true ]; then
  for st in a b d; do echo "register $st: $(J register t-w1a st-$st /srv/w1a/$st $(cat /proc/sys/kernel/random/uuid) --offline-confirmed)"; done
  echo "fence b: $(J fence t-w1a st-b /srv/w1a/b 1 $(cat /proc/sys/kernel/random/uuid) --offline-confirmed)"
  mv /srv/w1a/d /srv/w1a/d.prev && mkdir -p /srv/w1a/d/project && echo "replaced d"
fi
rm -f /var/lib/qwen-w1a/hosted-run/pub-state.json /var/lib/qwen-w1a/hosted-run/pub-up.json
sudo systemd-run --quiet --unit=w1a-pub --uid=wenshao --gid=wenshao --working-directory=/rig/vm /opt/qwen/node pub-up.mjs
for i in $(seq 1 60); do [ -f /var/lib/qwen-w1a/hosted-run/pub-state.json ] && curl -s --noproxy '*' -m 2 -o /dev/null http://127.0.0.1:17088/capabilities && break; sleep 1; done
bash svc.sh start
/opt/qwen/node s6-public.mjs
sudo systemctl stop w1a-pub
