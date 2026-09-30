#!/bin/bash
# usage: stress.sh <arm> <writers> <iters>
arm=$1; W=$2; N=$3
D=/root/verify/pr13119/run/stress-$arm-w$W; rm -rf $D; mkdir -p $D/qh
export QWEN_HOME=$D/qh QWEN_CODE_SYSTEM_SETTINGS_PATH=/nonexistent/s.json QWEN_CODE_SYSTEM_DEFAULTS_PATH=/nonexistent/d.json
cp /root/verify/pr13119/run/settings.initial.json $D/qh/settings.json
T=$D/qh/settings.json; STOP=$D/stop
for r in 1 2; do node stress-reader.mjs $arm $T $STOP > $D/reader$r.json 2>&1 & done
sleep 1
pids=""; for w in $(seq 1 $W); do node stress-writer.mjs $arm w$w $N $T > $D/writer$w.json 2>&1 & pids="$pids $!"; done
wait $pids; sleep 0.3; touch $STOP; wait
echo "== $arm writers=$W iters=$N"
cat $D/writer*.json; echo "readers:"; cat $D/reader*.json
echo "final: $(ls $D/qh | grep '^settings' | tr '\n' ' ')"
node -e "const j=JSON.parse(require('fs').readFileSync('$T','utf8'));console.log('final target: complete, policy', j.tools?.executionSandbox?'present':'MISSING', 'language', j.general?.language)" 2>&1 || echo "final target unreadable/absent"
