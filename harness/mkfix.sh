#!/bin/bash
# mkfix.sh <ws>  — fixture files for outbound file delivery
set -e
WS="$1"; mkdir -p "$WS/sub" /tmp/h10893
printf 'harness report %s\n' "$(date +%s%N)" > "$WS/report.txt"
head -c 3000 /dev/urandom > "$WS/blob.bin"
printf 'pdf-like content\n' > "$WS/report.pdf"
printf 'tarball\n' > "$WS/archive.tar.gz"
printf 'no extension\n' > "$WS/noext"
printf 'space name\n' > "$WS/with space.txt"
printf 'bracket\n' > "$WS/brk].txt"
printf 'nested\n' > "$WS/sub/nested.md"
: > "$WS/empty.txt"
head -c 1 /dev/urandom > "$WS/big.bin"; truncate -s $((20*1024*1024+1)) "$WS/big.bin"
head -c 1 /dev/urandom > "$WS/exact.bin"; truncate -s $((20*1024*1024)) "$WS/exact.bin"
ln -sfn /etc/hostname "$WS/escape-link"
ln -sfn "$WS/report.txt" "$WS/inside-link"
mkdir -p "$WS/adir"
printf 'tmp fixture\n' > /tmp/h10893/tmpfile.md
printf 'outside secret\n' > /root/h10893-outside.txt
for i in 1 2 3 4 5 6 7; do printf 'multi %s\n' $i > "$WS/m$i.txt"; done
ls -la "$WS" | head -30
