#!/bin/bash
# inside VM: install this rig (jars, bundles, service, loop filesystems). Re-runnable.  usage: setup-vm.sh <jar labels...>
set -eu
RIG=/Users/wenshao/pr13260-rig
sudo mkdir -p /opt/w1c/bin /srv/w1c-src /srv/w1c-dst /srv/w1c-mr /srv/w1c-decoy /srv/w1c-bundles /var/lib/qwen-w1c /var/log/qwen-w1c /var/lib/w1c-img
# Real, separate filesystems: source (ext4), target (ext4), and a fresh ext4 whose mount point IS a target root (lost+found).
for n in src dst mr; do
  img=/var/lib/w1c-img/$n.img
  [ -f $img ] || { sudo truncate -s 768M $img; sudo mkfs.ext4 -q -F $img; }
  mountpoint -q /srv/w1c-$n || sudo mount -o loop $img /srv/w1c-$n
done
sudo chown wenshao:wenshao /srv/w1c-src /srv/w1c-dst /srv/w1c-mr /srv/w1c-decoy /srv/w1c-bundles /var/lib/qwen-w1c /var/log/qwen-w1c
for j in "$@"; do for f in $RIG/server/$j-server*.jar; do b=$(basename $f); sudo cp $f /opt/w1c/$b; sudo chmod a+r /opt/w1c/$b; done; done
for d in head; do
  if [ -f $RIG/dist/$d/cli.js ]; then sudo rm -rf /opt/w1c/dist-$d; sudo cp -r $RIG/dist/$d /opt/w1c/dist-$d; sudo chmod -R a+rX /opt/w1c/dist-$d; fi
done
sudo cp /opt/w1a/adapter.jar /opt/w1c/adapter.jar; sudo chmod a+r /opt/w1c/adapter.jar
sudo cp $RIG/vm/run-server.sh /opt/w1c/run-server.sh; sudo chmod a+rx /opt/w1c/run-server.sh
sudo cp $RIG/vm/qwen-w1c.service /etc/systemd/system/qwen-w1c.service
[ -f /etc/qwen-w1c.env ] || sudo cp $RIG/vm/qwen-w1c.env /etc/qwen-w1c.env
sudo systemctl daemon-reload
sha256sum /opt/w1c/*.jar | cut -c1-16,65-
for d in /opt/w1c/dist-*; do [ -d "$d" ] || continue; echo "$d cli.js sha256=$(sha256sum $d/cli.js | cut -c1-16) files=$(find $d -type f | wc -l)"; done
df --output=source,fstype,target /srv/w1c-src /srv/w1c-dst /srv/w1c-mr /var/lib/qwen-w1c
stat -c '%n dev=%d ino=%i' /srv/w1c-src /srv/w1c-dst /srv/w1c-mr /var/lib/qwen-w1c
cat /etc/qwen-w1c.env
