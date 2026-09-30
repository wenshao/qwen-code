#!/bin/bash
# s5: large-output read cost on the Java server (OSS double on localhost).
R=$(cd $(dirname $0); pwd); S=$(dirname $R); LOG=$R/out/s5-perf.log; : > $LOG
NODE=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
say() { echo "$*" | tee -a $LOG; }
J=$R/out/s5-gib.json; GEN_BYTES=$BYTES
SID=$($NODE -e "console.log(require('$J').session)"); AID=$($NODE -e "console.log(require('$J').stdout.id)"); REV=$($NODE -e "console.log(require('$J').stdout.revision)"); BYTES=$($NODE -e "console.log(require('$J').stdout.bytes)")
URL="http://127.0.0.1:18037/v1/agents/sessions/$SID/artifacts/$AID/content?revision=$REV"
H=(-H "X-Qwen-Tenant-Id: t-o3" -H "X-Rig-Actor: alice")
PID=$(cat $R/run/spring.pid)
say "artifact bytes=$BYTES sha256=$REV  spring pid=$PID  heap: $(ps -o command= -p $PID | /usr/bin/grep -o '\-Xmx[0-9a-z]*' || echo default)  load: $(uptime | sed 's/.*averages: //')"
say "local run, first $BYTES bytes: $($NODE $R/gen.mjs gib 1073741824 0 0 2>/dev/null | head -c $BYTES | shasum -a 256 | cut -d' ' -f1)"
rss() { ps -o rss= -p $PID | awk '{printf "%.0f", $1/1024}'; }
sampler() { local peak=0; while [ -f $R/run/sampling ]; do v=$(rss); [ "$v" -gt "$peak" ] && peak=$v; sleep 0.5; done; echo $peak > $1; }
oss() { curl -s http://127.0.0.1:18937/state | $NODE -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const c=JSON.parse(d).counters;console.log(c.get+' '+c.versioning)})"; }
dl() { curl -s -o $R/run/body-$1 -w "%{http_code} %{size_download} %{time_total}" "${H[@]}" "$URL" > $R/run/out-$1; shasum -a 256 $R/run/body-$1 | cut -d' ' -f1 > $R/run/sha-$1; rm -f $R/run/body-$1; }
say "RSS before: $(rss) MiB"
read G0 V0 < <(oss); touch $R/run/sampling; sampler $R/run/peak1 & SP=$!
dl 1
rm -f $R/run/sampling; wait $SP; read G1 V1 < <(oss)
say "1 full download: status/bytes/seconds = $(cat $R/run/out-1)  sha256=$(cat $R/run/sha-1)  peak RSS=$(cat $R/run/peak1) MiB  object GETs=$((G1-G0)) versioning checks=$((V1-V0))"
touch $R/run/sampling; sampler $R/run/peak4 & SP=$!
for i in a b c d; do dl $i & P[${#P[@]}]=$!; done
for p in "${P[@]}"; do wait $p; done
rm -f $R/run/sampling; wait $SP
for i in a b c d; do say "parallel $i: $(cat $R/run/out-$i)  sha256=$(cat $R/run/sha-$i)"; done
say "4 parallel full downloads: peak RSS=$(cat $R/run/peak4) MiB; RSS after: $(rss) MiB"
say "OutOfMemoryError lines in the server log: $(/usr/bin/grep -c OutOfMemoryError $S/logs/spring-pr-${DB:-o3c}.log)"
