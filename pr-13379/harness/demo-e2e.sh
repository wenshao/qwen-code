#!/bin/bash
# Live re-run of the real-CLI E2E checks; prints a compact coloured transcript.
R=/root/verify/pr13379; RICH=$R/fx/rich-home; WS=$R/ws; O=$R/out/demo; mkdir -p $O
C='\033[1;36m'; G='\033[1;32m'; Y='\033[1;33m'; RD='\033[1;31m'; D='\033[2m'; B='\033[1m'; N='\033[0m'
label() { case $1 in base) echo "main@71fefc7";; head) echo "PR@87682bc  ";; mutdist) echo "mutant      ";; esac; }
printf "${D}# fixture: 21 entries in ~/.qwen/extensions = 6 batches of 4; batch 2 holds two manifests named 'dupe'${N}\n"
printf "${D}#   b00-dupe-first (1.0.0, 300 skills, finishes LAST)  b02-dupe-second (2.0.0, 1 skill)  + malformed manifest,${N}\n"
printf "${D}#   linked extension, Agent Plugins v1 plugin, plain file; d00..d07 shrink so loads complete in reverse.${N}\n"
printf "${D}# mutant = PR bundle patched to consume each batch in COMPLETION order (proves the oracle has teeth)${N}\n\n"
printf "${C}\$ qwen extensions list${N}   ${D}(real bundled CLI, isolated HOME)${N}\n"
for a in base head mutdist; do
  $R/harness/run-cli.sh $a $RICH $WS -- extensions list > $O/list-$a.out 2>$O/list-$a.err; rc=$?
  sum=$(sha256sum < $O/list-$a.out | cut -c1-12)
  dupe=$(grep -A2 '^✓ dupe' $O/list-$a.out | sed -n '1p;3p' | sed 's/^✓ //; s/ Path: .*extensions\///' | paste -sd' ' -)
  first=$(grep -E '^✓ ' $O/list-$a.out | head -3 | sed 's/^✓ //; s/ (.*//' | paste -sd, -)
  col=$G; [ $a = mutdist ] && col=$RD
  printf "  %s exit=%s  lines=%-5s sha256=${col}%s${N}  dupe -> ${col}%s${N}  first: %s\n" "$(label $a)" $rc $(wc -l < $O/list-$a.out) $sum "$dupe" "$first"
done
cmp -s $O/list-base.out $O/list-head.out && printf "  ${G}main == PR (byte-identical stdout)${N}   " || printf "  ${RD}main != PR${N}   "
cmp -s $O/list-base.out $O/list-mutdist.out && printf "${RD}mutant == main (oracle blind!)${N}\n" || printf "${Y}mutant != main (oracle detects completion-order consumption)${N}\n"

printf "\n${C}\$ qwen -p 'say OK'${N}   ${D}(fake OpenAI endpoint records the model-visible request)${N}\n"
for a in base head mutdist; do
  : > $R/out/e2e/fake-requests.jsonl
  $R/harness/run-cli.sh $a $RICH $WS -- --auth-type openai --openai-api-key dummy --openai-base-url http://127.0.0.1:18731/v1 --model fake-model --approval-mode default -p "say OK" > $O/p-$a.out 2>&1; rc=$?
  cp $R/out/e2e/fake-requests.jsonl $O/req-$a.jsonl
  python3 - $O/req-$a.jsonl > $O/req-$a.norm <<'PY'
import json,re,sys
for l in open(sys.argv[1]):
    s=json.dumps(json.loads(l)['body'],sort_keys=True)
    s=re.sub(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}','<uuid>',s)
    print(re.sub(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?','<ts>',s))
PY
  s=$(node $R/harness/extract-req.mjs $O/req-$a.jsonl)
  skills=$(echo "$s" | node -e "const s=JSON.parse(require('fs').readFileSync(0));process.stdout.write(s.skillCount+' skills, '+s.ctxMarkers.length+' context files, ctx[4]='+s.ctxMarkers[4].split(' ')[0]+', ctx[0..2]='+s.ctxMarkers.slice(0,3).map(x=>x.split(' ')[0]).join(','))")
  col=$G; [ $a = mutdist ] && col=$RD
  printf "  %s exit=%s reply=%-3s req=%s chars  ${col}%s${N}\n" "$(label $a)" $rc "$(tr -d '\n' < $O/p-$a.out)" $(head -1 $O/req-$a.norm | wc -c) "$skills"
done
cmp -s $O/req-base.norm $O/req-head.norm && printf "  ${G}main == PR: every request body identical after uuid/timestamp normalisation${N}\n" || printf "  ${RD}main != PR${N}\n"

printf "\n${C}\$ qwen serve${N}   ${D}(GET status, /summary, /extensions catalog, 5x /:name/details, 24 concurrent reads)${N}\n"
for a in base head; do node $R/harness/daemon-probe.mjs $a $RICH $O > $O/daemon-$a.log 2>&1
  printf "  %s %s\n" "$(label $a)" "$(node -e "const o=require('$O/daemon-$a.json');const st=Object.entries(o).filter(([k])=>k.startsWith('/')).map(([k,v])=>v.status);const c={};st.forEach(x=>c[x]=(c[x]||0)+1);process.stdout.write('8 routes -> '+Object.entries(c).map(([k,v])=>v+'x'+k).join(' ')+' (404 = /no-such-ext/details); 24 concurrent -> '+[...new Set(o.concurrent)].join(',')+', consistent='+o.concurrentConsistent)")"; done
python3 - $O <<'PY'
import json,re,sys
def n(a): return json.loads(re.sub(r'"generation": \d+','"generation": "N"',open(f'{sys.argv[1]}/daemon-{a}.json').read()))
b,h=n('base'),n('head'); same=all(b[k]==h[k] for k in b)
d=h['/workspace/extensions/dupe/details']['body']
print(('  \033[1;32mmain == PR: all route bodies identical (generation normalised)\033[0m' if same else '  \033[1;31mDIFF\033[0m') + f"   details(dupe) -> {d['version']} {d['path'].split('/')[-1]}")
PY

printf "\n${C}\$ ln -s /nonexistent/gone ~/.qwen/extensions/a01z-dangling && qwen extensions list${N}\n"
for a in base head; do
  $R/harness/run-cli.sh $a $R/fx/dangling-home $WS -- extensions list > /dev/null 2> $O/dl-$a.err; rc=$?
  printf "  %s exit=%s  ${Y}%s${N}\n" "$(label $a)" $rc "$(head -1 $O/dl-$a.err | sed 's#/root/verify/pr13379/fx/dangling-home#~#' | cut -c1-90)"
done
printf "  ${D}(pre-existing on main: one dangling entry fails the whole scan; the PR keeps that contract unchanged)${N}\n"
