#!/bin/bash
# inside VM: extra storage roots for the birth-time probes.
#   l = ext4 image on a loop device (default 256-byte inodes: has a birth time)
#   n = ext4 image with 128-byte inodes (no room for i_crtime: statx reports no birth time)
#   t = tmpfs                       v = virtiofs host share (bind mount)
# usage: s13-mounts.sh up | down
set -u
B=/srv/w1a; L=/var/lib/qwen-w1a/l13.img; N=/var/lib/qwen-w1a/n13.img; VFS=/rig/vfs/v13
case "$1" in
  down)
    for m in l n v t; do sudo umount $B/$m 2>/dev/null; done
    for i in $L $N; do for d in $(sudo losetup -j $i -O NAME -n); do sudo losetup -d $d 2>/dev/null; done; done
    sudo rm -f $L $N; rm -rf $VFS
    ;;
  up)
    mkdir -p $B/l $B/n $B/v $B/t; rm -rf $VFS; mkdir -p $VFS
    sudo rm -f $L $N
    truncate -s 64M $L && mkfs.ext4 -q -F $L
    truncate -s 64M $N && mkfs.ext4 -q -F -I 128 $N 2>/dev/null
    sudo mount -o loop $L $B/l && sudo chown rig:rig $B/l
    sudo mount -o loop $N $B/n && sudo chown rig:rig $B/n
    sudo mount --bind $VFS $B/v
    sudo mount -t tmpfs -o uid=$(id -u),gid=$(id -g),mode=0775 tmpfs $B/t
    for m in l n v t; do mkdir -p $B/$m/project; done
    sleep 0.05; for m in l n v t; do touch $B/$m; done
    for m in l n v t; do echo "$m: $(findmnt -n -T $B/$m -o SOURCE,FSTYPE | tr -s ' ') inode-size=$(sudo tune2fs -l $(findmnt -n -T $B/$m -o SOURCE) 2>/dev/null | awk '/Inode size/{print $3}')"; done
    ;;
esac
