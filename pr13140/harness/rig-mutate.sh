#!/bin/sh
# Build control + mutated helpers from the head C source and swap them into a copy of the head install.
set -e
SRC=/src13140/packages/core/vendor/landlock-run/src
rm -rf /tmp/mut && mkdir -p /tmp/mut && cp $SRC/* /tmp/mut/
cd /tmp/mut
build() { gcc -std=gnu11 -Os -Wall -Wextra -o "$1" qwen-landlock-run.c; }
cp stdio-relay.h stdio-relay.h.orig
build /tmp/mut/control
# M1: drop the post-exit lseek (shared offset accounting)
sed 's/lseek(STDIN_FILENO, initial + sent - unread, SEEK_SET) < 0/0/' stdio-relay.h.orig > stdio-relay.h
grep -c "initial + sent - unread" stdio-relay.h || true
build /tmp/mut/m1-no-lseek
# M2: stop polling for child exit while a FIFO is open (wait for EOF first)
sed 's/pid_t observed = waitpid(child, \&status, WNOHANG);/pid_t observed = (!eof || pending) ? 0 : waitpid(child, \&status, WNOHANG);/' stdio-relay.h.orig > stdio-relay.h
grep -c "(!eof || pending) ? 0" stdio-relay.h
build /tmp/mut/m2-wait-eof
cp stdio-relay.h.orig stdio-relay.h
rm -rf /opt/head-mut && cp -a /opt/head-local /opt/head-mut
ls -la /tmp/mut/control /tmp/mut/m1-no-lseek /tmp/mut/m2-wait-eof
