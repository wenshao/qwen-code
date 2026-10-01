#!/bin/bash
# Round 2, real OSS leg on schema o3r2: a new private temporary bucket, deleted at the end.
R=$(cd $(dirname $0); pwd); cd $R; S=$(dirname $R)
export DB=o3r2
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
B=$R/out/batch-d.log
step() { echo "$(date +%T) START $1" >> $B; shift; "$@" > /dev/null 2>> $B; echo "$(date +%T) END rc=$?" >> $B; }
J=("$HOME/Install/jdk21/bin/java" -Dhttps.proxyHost= -Dhttp.proxyHost= -DsocksProxyHost= -cp "out:lib/*")
NAME="qwen-pr13037-verify-$(openssl rand -hex 3)"
(cd $S/realoss && echo -n "$NAME" > bucket.txt && "${J[@]}" RealOss create "$NAME" 2>&1 | grep -v "commons-logging\|SLF4J" | sed "s/$NAME/qwen-pr13037-verify-<redacted>/g") >> out/s12-realoss-bucket.log
grep -q "created qwen-pr13037-verify-<redacted> acl=private" out/s12-realoss-bucket.log || { echo "BUCKET CREATE FAILED" >> $B; exit 9; }
./stop.sh harness spring >> $B 2>&1
env OSS_MODE=real OSS_BUCKET=$NAME ARTIFACTS=true PUB_ORIGINAL=true PUB_PREVIEW=true ./start.sh pr $DB > $R/run/last-restart.log 2>&1
if grep -q "harness via tap: 200" $R/run/last-restart.log; then
  step s12 $N s12-realoss.mjs
  step s12b ./s12b.sh
else
  echo "RESTART FAILED - skipping the real OSS scenarios" >> $B
fi
./stop.sh harness spring >> $B 2>&1
$S/realoss/cleanup.sh >> out/s12-realoss-bucket.log 2>&1
echo "$(date +%T) BATCH D DONE" >> $B
