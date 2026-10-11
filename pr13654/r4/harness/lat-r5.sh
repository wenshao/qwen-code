#!/bin/bash
# Report round 4: paired 128 MiB latency (head 569befb8 async vs base 6936c77e sync), both lanes + both proxies up.
R=$(cd $(dirname $0); pwd); NODE=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
cd $R
if ! lsof -nP -iTCP:18666 -sTCP:LISTEN -t >/dev/null; then (DATA_PORT=18665 CTRL_PORT=18666 TARGET=http://127.0.0.1:18664 nohup $NODE fault-proxy.mjs > run/fault-proxy-l2.log 2>&1 & echo $! > run/fault-proxy-l2.pid); fi
for i in $(seq 1 30); do curl -s --noproxy '*' http://127.0.0.1:18666/rules >/dev/null && break; sleep 1; done
echo "lane-2 proxy $(cat run/fault-proxy-l2.pid 2>/dev/null) rules=$(curl -s --noproxy '*' http://127.0.0.1:18666/rules)"
$R/r5.sh UP
DB1=p654r5b DB2=p654r5a PLOG=paired-r5 PB=pr5 N0=50 $R/paired2.sh "M"
echo "lat-r5 done $(date +%T)" >> $R/out/paired-r5.log
