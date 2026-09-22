. /root/verify/h12267r5/fig6/common.sh; cd /root/verify/h12267r5
M="--approval-mode yolo --auth-type openai --openai-api-key dummy --openai-base-url http://127.0.0.1:18431/v1 --model dummy -o text -p hi"
hdr "PR #12267 round 5 (exact head 479027b0a7) - declared fixes that hold (scripted model; system prompt read off the wire)"
hdr "session prompt sandbox section"
for p in none ro-closed ww-closed; do line=""; for a in r6pre r6; do rm -f out/requests.jsonl; timeout -k 2 90 $Q $a $p $M >/dev/null 2>&1
  sec=$(node -e 'const l=require("fs").readFileSync("out/requests.jsonl","utf8").trim().split("\n").map(JSON.parse);const m=l.find(x=>(x.body.messages||[]).some(y=>y.role==="system"));const s=m.body.messages.find(y=>y.role==="system");const t=typeof s.content==="string"?s.content:s.content.map(c=>c.text).join("");const h=(t.match(/^# (Outside of Sandbox|Tool Execution Sandbox \(bwrap\))$/m)||[])[1];const w=(t.match(/workspace is (writable|read-only)/)||[])[1];console.log(h+(w?" / workspace "+w:""))')
  line="$line  $a: $(printf '%-44s' "$sec")"; done
  printf "  %-10s%s\n" "$p" "$line"; done
echo; hdr "legacy environment with a policy active  (headless -p, policy workspace-write/closed)"
row() { local lbl=$1; shift; local l=""; for a in r6pre r6; do env "$@" timeout -k 2 90 $Q $a ww-closed $M >/dev/null 2>e.txt; rc=$?; l="$l  $a: $( [ $rc = 0 ] && printf "${G}starts${N}  " || printf "${R}rejects${N} " )"; done; printf "  %-40s%b\n" "$lbl" "$l"; }
row "PROXY_COMMAND=/usr/bin/nc" PROXY_COMMAND=/usr/bin/nc
row "QWEN_SANDBOX_NET= (empty)" QWEN_SANDBOX_NET=
row "QWEN_SANDBOX_PROXY_COMMAND= (empty)" QWEN_SANDBOX_PROXY_COMMAND=
row "SANDBOX='  ' (blank)" "SANDBOX=  "
row "control: QWEN_SANDBOX_NET=none" QWEN_SANDBOX_NET=none
row "control: QWEN_SANDBOX_PROXY_COMMAND=/x" QWEN_SANDBOX_PROXY_COMMAND=/x
row "control: SANDBOX=bwrap" SANDBOX=bwrap
echo; hdr "boundary at this head: qwen sandbox --verify, 4 policies x 2 uids"
for p in ww-closed ro-closed ww-open ro-open; do r0=$(timeout -k 2 60 $Q r6 $p sandbox --verify 2>&1 | grep -c '^PASS')
  r1=$(cd nobody/ws && timeout -k 2 60 setpriv --reuid=65534 --regid=65534 --clear-groups env HOME=/root/verify/h12267r5/nobody QWEN_HOME=/root/verify/h12267r5/nobody/home-$p QWEN_CODE_SYSTEM_SETTINGS_PATH=/nonexistent/s.json QWEN_CODE_SYSTEM_DEFAULTS_PATH=/nonexistent/d.json node /root/verify/pr12267-r6/dist/cli.js sandbox --verify 2>&1 | grep -c '^PASS')
  ok "$(printf '%-10s' $p) uid 0: $r0/4 PASS    uid 65534: $r1/4 PASS"; done
