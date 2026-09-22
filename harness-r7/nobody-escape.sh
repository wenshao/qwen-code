#!/bin/bash
# uid 65534 rows: fd0 escape attempts against host files the invoking user (root) owns.
# Runs the CLI from a nobody-readable copy of the bundle (host /root is 700).
ART=/root/git/qwen-code-verify/tmp/pr12267-verify-20260922-164444
NB=/tmp/pr12267-r7-nobody
ARM=$1
mkdir -p $NB/victims/sub $NB/home-ro-closed $NB/ws
printf 'nobody-original\n' > $NB/victims/owned.txt
cp $ART/scratch/home-ro-closed/settings.json $NB/home-ro-closed/settings.json
rm -rf $NB/dist-$ARM
cp -r $ART/$ARM-tree/dist $NB/dist-$ARM || exit 1
chmod 755 $NB; chmod -R a+rX $NB
chown -R 65534:65534 $NB/home-ro-closed $NB/ws $NB/victims
cd $NB/ws
setpriv --reuid=65534 --regid=65534 --clear-groups env -u QWEN_RUNTIME_DIR -u SANDBOX -u QWEN_SANDBOX \
  HOME=$NB QWEN_HOME=$NB/home-ro-closed QWEN_CODE_SYSTEM_SETTINGS_PATH=/nonexistent/sys.json QWEN_CODE_SYSTEM_DEFAULTS_PATH=/nonexistent/sysdef.json \
  node $NB/dist-$ARM/cli.js sandbox -- sh -c "id -u; echo direct > $NB/victims/owned.txt 2>&1 || true; echo via-fd0 > /proc/self/fd/0 && echo fd0-write=ok" < $NB/victims/owned.txt 2>&1 | grep -v -e '^Boundary' -e '^Filesystem' -e '^Command network' -e '^Model,' -e '^Host reads' -e '^Backend probe'
echo "host file: $(cat $NB/victims/owned.txt)"
printf 'nobody-original\n' > $NB/victims/owned.txt
setpriv --reuid=65534 --regid=65534 --clear-groups env -u QWEN_RUNTIME_DIR -u SANDBOX -u QWEN_SANDBOX \
  HOME=$NB QWEN_HOME=$NB/home-ro-closed QWEN_CODE_SYSTEM_SETTINGS_PATH=/nonexistent/sys.json QWEN_CODE_SYSTEM_DEFAULTS_PATH=/nonexistent/sysdef.json \
  node $NB/dist-$ARM/cli.js sandbox -- sh -c "echo rooted > /proc/self/fd/0/../../../../../../../../../..$NB/victims/from-host-root.txt && echo root-walk-write=ok" < $NB/victims/sub 2>&1 | grep -v -e '^Boundary' -e '^Filesystem' -e '^Command network' -e '^Model,' -e '^Host reads' -e '^Backend probe'
ls -la $NB/victims/ | grep from-host-root || echo "no from-host-root.txt"
rm -f $NB/victims/from-host-root.txt
