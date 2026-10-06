#!/bin/bash
# inside VM after a reboot: re-attach the loop images in the original order and wait for MySQL.
for n in src dst mr; do mountpoint -q /srv/w1c-$n || sudo mount -o loop /var/lib/w1c-img/$n.img /srv/w1c-$n; done
stat -c '%n dev=%d' /srv/w1c-src /srv/w1c-dst /srv/w1c-mr
for i in $(seq 1 60); do docker exec w0e3-db mysql -uroot -prootpw -e 'SELECT 1' >/dev/null 2>&1 && break; sleep 1; done
echo "mysql ready after ${i}s; boot_id=$(cat /proc/sys/kernel/random/boot_id)"
