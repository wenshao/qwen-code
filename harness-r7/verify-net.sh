#!/bin/bash
# Boundary: sandbox --verify across 4 policies x uid {0,65534}; network closed/open probe
ART=/root/git/qwen-code-verify/tmp/pr12267-verify-20260922-164444
cd "$ART/scratch"
Q="$ART/harness-r7/q.sh"
for POL in ro-closed ro-open ww-closed ww-open; do
  vout=$($Q head $POL sandbox --verify 2>&1); vrc=$?
  line=$(echo "$vout" | grep -E 'Confinement|verified|fail' | head -1)
  echo "root  $POL rc=$vrc | $line"
  # uid 65534 via nobody-readable copy
  NB=/tmp/pr12267-r7-nobody
  mkdir -p $NB/home-$POL; cp $ART/scratch/home-$POL/settings.json $NB/home-$POL/settings.json
  rm -rf $NB/dist-head; cp -r $ART/head-tree/dist $NB/dist-head; chmod -R a+rX $NB; chown -R 65534:65534 $NB/home-$POL
  out2=$(cd $NB/ws && setpriv --reuid=65534 --regid=65534 --clear-groups env -u QWEN_RUNTIME_DIR HOME=$NB QWEN_HOME=$NB/home-$POL QWEN_CODE_SYSTEM_SETTINGS_PATH=/nonexistent/sys.json QWEN_CODE_SYSTEM_DEFAULTS_PATH=/nonexistent/sysdef.json node $NB/dist-head/cli.js sandbox --verify 2>&1 | grep -E 'Confinement|verified|fail' | head -1)
  echo "65534 $POL rc=$? | $out2"
done
# network: host loopback listener on 18999
python3 -c "
import socket,threading,sys,time
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(('127.0.0.1',18999)); s.listen(1)
def acc():
  try:
    c,_=s.accept(); c.close()
  except Exception: pass
threading.Thread(target=acc,daemon=True).start()
open('$ART/scratch/net-ready','w').write('1')
time.sleep(60)
" &
sleep 1
for POL in ww-closed ww-open; do
  res=$($Q head $POL sandbox -- sh -c 'ls /sys/class/net | tr "\n" ","; bash -c "(echo > /dev/tcp/127.0.0.1/18999) 2>/dev/null && echo CONNECTED || echo REFUSED"' 2>/dev/null | tail -2 | tr '\n' ' ')
  echo "$POL: $res"
done
kill %1 2>/dev/null
