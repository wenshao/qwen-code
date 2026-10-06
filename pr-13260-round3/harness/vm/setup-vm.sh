#!/bin/bash
# inside VM: install this rig (jars, bundles, service, loop filesystems). Re-runnable.  usage: setup-vm.sh <jar labels...>
set -eu
RIG=/root/verify/pr13260/rig
mkdir -p /opt/pr13260/bin /srv/pr13260/src /srv/pr13260/dst /srv/pr13260/mr /srv/pr13260/decoy /srv/pr13260/bundles /var/lib/pr13260 /var/lib/pr13260/log /var/lib/w1c-img
# Real, separate filesystems: source (ext4), target (ext4), and a fresh ext4 whose mount point IS a target root (lost+found).
for n in src dst mr; do
  img=/var/lib/w1c-img/$n.img
  [ -f $img ] || { truncate -s 768M $img; mkfs.ext4 -q -F $img; }
  mountpoint -q /srv/w1c-$n || mount -o loop $img /srv/w1c-$n
done
chown w1crig:w1crig /srv/pr13260/src /srv/pr13260/dst /srv/pr13260/mr /srv/pr13260/decoy /srv/pr13260/bundles /var/lib/pr13260 /var/lib/pr13260/log
for j in "$@"; do for f in $RIG/server/$j-server*.jar; do b=$(basename $f); cp $f /opt/pr13260/$b; chmod a+r /opt/pr13260/$b; done; done
for d in head; do
  if [ -f $RIG/dist/$d/cli.js ]; then rm -rf /opt/pr13260/dist-$d; cp -r $RIG/dist/$d /opt/pr13260/dist-$d; chmod -R a+rX /opt/pr13260/dist-$d; fi
done
cp /opt/w1a/adapter.jar /opt/pr13260/adapter.jar; chmod a+r /opt/pr13260/adapter.jar
cp $RIG/vm/run-server.sh /opt/pr13260/run-server.sh; chmod a+rx /opt/pr13260/run-server.sh
cp $RIG/vm/pr13260-spring.service /etc/systemd/system/pr13260-spring.service
[ -f /opt/pr13260/rig.env ] || cp $RIG/vm/qwen-w1c.env /opt/pr13260/rig.env
systemctl daemon-reload
sha256sum /opt/pr13260/*.jar | cut -c1-16,65-
for d in /opt/pr13260/dist-*; do [ -d "$d" ] || continue; echo "$d cli.js sha256=$(sha256sum $d/cli.js | cut -c1-16) files=$(find $d -type f | wc -l)"; done
df --output=source,fstype,target /srv/pr13260/src /srv/pr13260/dst /srv/pr13260/mr /var/lib/pr13260
stat -c '%n dev=%d ino=%i' /srv/pr13260/src /srv/pr13260/dst /srv/pr13260/mr /var/lib/pr13260
cat /opt/pr13260/rig.env
