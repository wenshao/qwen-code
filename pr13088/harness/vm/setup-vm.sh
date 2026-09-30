#!/bin/bash
# inside VM: install this rig (jars, bundles, service). Re-runnable.
set -eu
RIG=/rig
sudo mkdir -p /opt/w1a/bin /srv/w1a /srv/w1a-decoy /var/lib/qwen-w1a /var/log/qwen-w1a
sudo chown wenshao:wenshao /srv/w1a /srv/w1a-decoy /var/lib/qwen-w1a /var/log/qwen-w1a
for j in "$@"; do sudo cp $RIG/server/$j-server.jar /opt/w1a/$j-server.jar; sudo chmod a+r /opt/w1a/$j-server.jar; done
for d in head base merge surv; do
  if [ -f $RIG/dist/$d/cli.js ]; then sudo rm -rf /opt/w1a/dist-$d; sudo cp -r $RIG/dist/$d /opt/w1a/dist-$d; sudo chmod -R a+rX /opt/w1a/dist-$d; fi
done
sudo cp $RIG/vm/adapter.jar /opt/w1a/adapter.jar; sudo chmod a+r /opt/w1a/adapter.jar
sudo cp $RIG/vm/run-server.sh /opt/w1a/run-server.sh; sudo chmod a+rx /opt/w1a/run-server.sh
sudo cp $RIG/vm/qwen-w1a.service /etc/systemd/system/qwen-w1a.service
[ -f /etc/qwen-w1a.env ] || sudo cp $RIG/vm/qwen-w1a.env /etc/qwen-w1a.env
sudo systemctl daemon-reload
sha256sum /opt/w1a/*.jar | cut -c1-16,65-
for d in /opt/w1a/dist-*; do echo "$d cli.js sha256=$(sha256sum $d/cli.js | cut -c1-16) files=$(find $d -type f | wc -l)"; done
cat /etc/qwen-w1a.env
