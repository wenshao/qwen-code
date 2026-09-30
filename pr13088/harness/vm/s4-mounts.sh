#!/bin/bash
# inside VM: storage roots on different filesystems under /srv/w1a.
#   a = plain directory on the ext4 root disk      l = ext4 image on a loop device
#   v = virtiofs host share (bind mount)           t = tmpfs
# usage: s4-mounts.sh up [shuffle]   (shuffle: another loop device is attached first, so the image gets a different loop number)
#        s4-mounts.sh down
set -u
B=/srv/w1a; IMG=/var/lib/qwen-w1a/l.img; VFS=/rig/vfs/v
case "$1" in
  down)
    for m in l v t; do sudo umount $B/$m 2>/dev/null; done
    for d in $(sudo losetup -j $IMG -O NAME -n) $(sudo losetup -j /var/lib/qwen-w1a/dummy.img -O NAME -n); do sudo losetup -d $d 2>/dev/null; done
    ;;
  up)
    mkdir -p $B/a/project $B/l $B/v $B/t $VFS
    [ -f $IMG ] || { truncate -s 64M $IMG && mkfs.ext4 -q -F $IMG; }
    if [ "${2:-}" = shuffle ]; then truncate -s 8M /var/lib/qwen-w1a/dummy.img; echo "dummy image attached first: $(sudo losetup -f --show /var/lib/qwen-w1a/dummy.img)"; fi
    sudo mount -o loop $IMG $B/l && sudo chown wenshao:wenshao $B/l
    sudo mount --bind $VFS $B/v
    sudo mount -t tmpfs -o uid=$(id -u),gid=$(id -g),mode=0775 tmpfs $B/t
    for m in l v t; do mkdir -p $B/$m/project; done
    for m in a l v t; do echo "$m: $(findmnt -n -T $B/$m -o SOURCE,FSTYPE | tr -s ' ') $(stat -c 'dev=%d (%Hd:%Ld) ino=%i' $B/$m)"; done
    ;;
esac
