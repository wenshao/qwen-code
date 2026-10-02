#!/bin/sh
# Round 3: control + 3 mutants of the socket-transport stdio-relay.h, swapped into a copy of the head install.
set -e
SRC=/src13140/packages/core/vendor/landlock-run/src
rm -rf /tmp/mut3 && mkdir -p /tmp/mut3 && cp $SRC/* /tmp/mut3/ && cd /tmp/mut3 && cp stdio-relay.h orig.h
build() { gcc -std=gnu11 -Os -Wall -Wextra -o "$1" qwen-landlock-run.c; }
build /tmp/mut3/control
sed 's/lseek(STDIN_FILENO, initial + sent - unread, SEEK_SET) < 0/0/' orig.h > stdio-relay.h; echo "M1 $(grep -c 'initial + sent - unread' stdio-relay.h)"; build /tmp/mut3/m1-no-lseek
sed 's/pid_t observed = waitpid(child, \&status, WNOHANG);/pid_t observed = (!eof || pending) ? 0 : waitpid(child, \&status, WNOHANG);/' orig.h > stdio-relay.h; echo "M2 $(grep -c '(!eof || pending) ? 0' stdio-relay.h)"; build /tmp/mut3/m2-wait-eof
sed 's/remaining = recv(channel\[0\], buffer, sizeof(buffer), MSG_DONTWAIT);/remaining = 0;/' orig.h > stdio-relay.h; echo "M3 $(grep -c 'remaining = 0;' stdio-relay.h)"; build /tmp/mut3/m3-no-drain
sed 's/shutdown(channel\[0\], SHUT_WR) != 0/0/' orig.h > stdio-relay.h; echo "M4 $(grep -c 'SHUT_WR' stdio-relay.h)"; build /tmp/mut3/m4-no-shutwr
cp orig.h stdio-relay.h
rm -rf /opt/head-mut && cp -a /opt/head-local /opt/head-mut
