#!/bin/bash
# inside VM: does a directory that is deleted and restored from a backup at the same pathname get the same (device, inode)?
set -eu
P=/srv/w1a/inode-probe; rm -rf "$P"; mkdir -p "$P"; cd "$P"
mkdir -p r/project; echo data > r/project/f.txt; echo '{"marker":1}' > r/.qwen-managed-storage.json
echo "filesystem: $(findmnt -n -T "$P" -o SOURCE,FSTYPE | tr -s ' ')"
same=0
for i in 1 2 3 4 5 6; do
  a=$(stat -c '%d:%i' r); b=$(stat -c %W r)
  tar -cf "$P/r.tar" r; rm -rf r
  [ $((i % 2)) -eq 0 ] && { mkdir other-$i; touch other-$i/x; }   # even rounds: some unrelated activity in between
  tar -xf "$P/r.tar"
  c=$(stat -c '%d:%i' r); d=$(stat -c %W r)
  [ "$a" = "$c" ] && same=$((same+1))
  echo "round $i: dev:ino $a -> $c  birth time $b -> $d  $([ "$a" = "$c" ] && echo 'SAME device+inode' || echo 'different inode')"
  sleep 1
done
echo "same (device, inode) after delete + restore: $same/6"
cd /; rm -rf "$P"
