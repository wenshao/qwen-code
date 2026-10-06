#!/usr/bin/env bash
# start-arm.sh <arm> [keep]  : fresh run dir unless "keep"
cd /root/verify/pr13468
arm=$1; if [ $arm = base ]; then FP=18466; DP=18470; else FP=18467; DP=18471; fi
[ "$2" = keep ] || { rm -rf runs/$arm; mkdir -p runs/$arm; }
ss -ltnH "sport = :$DP" | grep -q . && { echo "port $DP busy"; exit 1; }
LOG=$PWD/runs/$arm/model.jsonl PORT=$FP setsid node harness/fake-model.cjs >> logs/fake-$arm.log 2>&1 < /dev/null &
setsid harness/start-daemon.sh $PWD/head/arms/$arm $PWD/runs/$arm $DP http://127.0.0.1:$FP >> logs/daemon-$arm.log 2>&1 < /dev/null &
for i in $(seq 1 60); do c=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -H 'authorization: Bearer tok13468' http://127.0.0.1:$DP/capabilities); [ "$c" = 200 ] && break; sleep 0.5; done
echo "$arm up: daemon $DP fake $FP ($c)"
