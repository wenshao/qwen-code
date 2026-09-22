#!/bin/bash
# uid 65534: confined command tries to write a user-owned file outside ws via the inherited stdin fd,
# and to walk .. to the host root. Fix must block all; parent allows.
ARM=$1; V=/root/verify/r7
mkdir -p $V/nobody/victims $V/nobody/victims/sub $V/nobody/ws
chmod -R 777 $V/nobody
printf 'nobody-original\n' > $V/nobody/victims/owned.txt; chmod 666 $V/nobody/victims/owned.txt
filt() { grep -v -e '^Boundary' -e '^Filesystem' -e '^Command' -e '^Model' -e '^Host' -e '^Backend' -e '^Requested' -e '^Effective' -e '^Workspace'; }
cd $V/nobody/ws
setpriv --reuid=65534 --regid=65534 --clear-groups env HOME=$V/nobody QWEN_HOME=$V/nobody/home QWEN_CODE_SYSTEM_SETTINGS_PATH=/nonexistent QWEN_CODE_SYSTEM_DEFAULTS_PATH=/nonexistent \
  node $V/dist-$ARM/cli.js sandbox -- sh -c 'echo "uid=$(id -u)"; echo via-fd0 > /proc/self/fd/0 && echo fd0-write=ok || echo fd0-blocked' < $V/nobody/victims/owned.txt 2>&1 | filt
echo "  host owned.txt now: $(cat $V/nobody/victims/owned.txt | tr -d '\n')"
printf 'nobody-original\n' > $V/nobody/victims/owned.txt
setpriv --reuid=65534 --regid=65534 --clear-groups env HOME=$V/nobody QWEN_HOME=$V/nobody/home QWEN_CODE_SYSTEM_SETTINGS_PATH=/nonexistent QWEN_CODE_SYSTEM_DEFAULTS_PATH=/nonexistent \
  node $V/dist-$ARM/cli.js sandbox -- sh -c 'echo rooted > /proc/self/fd/0/../../../../../../../../root/verify/r7/nobody/victims/from-host-root.txt && echo root-walk=ok || echo root-walk-blocked' < $V/nobody/victims/sub 2>&1 | filt
[ -f $V/nobody/victims/from-host-root.txt ] && echo "  from-host-root.txt CREATED" || echo "  from-host-root.txt absent"
rm -f $V/nobody/victims/from-host-root.txt
