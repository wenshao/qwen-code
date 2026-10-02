#!/bin/bash
# usage: arm-restore.sh <db>  -- restore the satsrc snapshot (DB + fake OSS objects + broker state) under a new DB name
R=$(cd $(dirname $0); pwd); cd $R; DB=$1; N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
B=/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin; C=(-uroot -ppw13090 -h127.0.0.1 -P33091)
$B/mysql "${C[@]}" -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB" 2>/dev/null && $B/mysql "${C[@]}" $DB < snap/satsrc.sql 2>/dev/null || { echo "restore failed"; exit 1; }
[ -f run/fake-oss.pid ] && kill $(cat run/fake-oss.pid) 2>/dev/null; sleep 1
mkdir -p trash; [ -d oss-data ] && mv oss-data trash/oss-data-$(date +%s%N); cp -Rc snap/oss-data oss-data
mkdir -p run/state-$DB-38094 && cp -Rc snap/state-satsrc/. run/state-$DB-38094/
(nohup $N fake-oss.mjs > run/fake-oss.log 2>&1 < /dev/null & echo $! > run/fake-oss.pid)
for i in $(seq 1 30); do curl -s http://127.0.0.1:38994/state >/dev/null && break; sleep 0.5; done
echo "restored $DB: pubs=$($B/mysql "${C[@]}" -N -e "SELECT COUNT(*) FROM $DB.qwen_tool_publication" 2>/dev/null) oss=$(curl -s http://127.0.0.1:38994/state | grep -o '"objects":[0-9]*')"
