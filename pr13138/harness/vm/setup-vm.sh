#!/bin/bash
# inside VM: install this rig (jars, bundles, service). Re-runnable.  usage: setup-vm.sh <jar labels...>
set -eu
RIG=/Users/wenshao/pr13138-rig
sudo mkdir -p /opt/w1b/bin /srv/w1b /srv/w1b-decoy /srv/w1b-bundles /var/lib/qwen-w1b /var/log/qwen-w1b
sudo chown wenshao:wenshao /srv/w1b /srv/w1b-decoy /srv/w1b-bundles /var/lib/qwen-w1b /var/log/qwen-w1b
for j in "$@"; do for f in $RIG/server/$j-server*.jar; do b=$(basename $f); sudo cp $f /opt/w1b/$b; sudo chmod a+r /opt/w1b/$b; done; done
for d in head base; do
  if [ -f $RIG/dist/$d/cli.js ]; then sudo rm -rf /opt/w1b/dist-$d; sudo cp -r $RIG/dist/$d /opt/w1b/dist-$d; sudo chmod -R a+rX /opt/w1b/dist-$d; fi
done
sudo cp /opt/w1a/adapter.jar /opt/w1b/adapter.jar; sudo chmod a+r /opt/w1b/adapter.jar
[ -d /opt/w1b/o2 ] || sudo cp -a /opt/w1a/o2 /opt/w1b/o2
sudo cp $RIG/vm/run-server.sh /opt/w1b/run-server.sh; sudo chmod a+rx /opt/w1b/run-server.sh
sudo cp $RIG/vm/qwen-w1b.service /etc/systemd/system/qwen-w1b.service
[ -f /etc/qwen-w1b.env ] || sudo cp $RIG/vm/qwen-w1b.env /etc/qwen-w1b.env
sudo systemctl daemon-reload
sha256sum /opt/w1b/*.jar | cut -c1-16,65-
for d in /opt/w1b/dist-*; do echo "$d cli.js sha256=$(sha256sum $d/cli.js | cut -c1-16) files=$(find $d -type f | wc -l)"; done
cat /etc/qwen-w1b.env
