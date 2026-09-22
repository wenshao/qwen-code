#!/bin/bash
# uid 65534: confined command reaches a file the user owns outside the workspace via the inherited stdin fd, and walks .. to the host root
ARM=$1
cd /root/verify/h12267r6/nobody/ws
setpriv --reuid=65534 --regid=65534 --clear-groups env HOME=/root/verify/h12267r6/nobody QWEN_HOME=/root/verify/h12267r6/nobody/home-ro-closed QWEN_CODE_SYSTEM_SETTINGS_PATH=/nonexistent/sys.json QWEN_CODE_SYSTEM_DEFAULTS_PATH=/nonexistent/sysdef.json \
  node /root/verify/pr12267-$ARM/dist/cli.js sandbox -- sh -c 'id -u; echo direct > /root/verify/h12267r6/nobody/victims/owned.txt 2>&1 || true; echo via-fd0 > /proc/self/fd/0 && echo fd0-write=ok' < /root/verify/h12267r6/nobody/victims/owned.txt 2>&1 | grep -v -e '^Boundary' -e '^Filesystem' -e '^Command network' -e '^Model,' -e '^Host reads' -e '^Backend probe'
echo "host file: $(cat /root/verify/h12267r6/nobody/victims/owned.txt)"
printf 'nobody-original\n' > /root/verify/h12267r6/nobody/victims/owned.txt
setpriv --reuid=65534 --regid=65534 --clear-groups env HOME=/root/verify/h12267r6/nobody QWEN_HOME=/root/verify/h12267r6/nobody/home-ro-closed QWEN_CODE_SYSTEM_SETTINGS_PATH=/nonexistent/sys.json QWEN_CODE_SYSTEM_DEFAULTS_PATH=/nonexistent/sysdef.json \
  node /root/verify/pr12267-$ARM/dist/cli.js sandbox -- sh -c 'echo rooted > /proc/self/fd/0/../../../../../../../../../root/verify/h12267r6/nobody/victims/from-host-root.txt && echo root-walk-write=ok' < /root/verify/h12267r6/nobody/victims/sub 2>&1 | grep -v -e '^Boundary' -e '^Filesystem' -e '^Command network' -e '^Model,' -e '^Host reads' -e '^Backend probe'
ls -la /root/verify/h12267r6/nobody/victims/ | grep from-host-root || echo "no from-host-root.txt"
rm -f /root/verify/h12267r6/nobody/victims/from-host-root.txt
