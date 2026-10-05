#!/bin/bash
# Live: the PR's two new tests on PR head and on main's serial loop (negative control); then the mutation matrix from saved JSON.
R=/root/verify/pr13379; C='\033[1;36m'; G='\033[1;32m'; RD='\033[1;31m'; Y='\033[1;33m'; D='\033[2m'; N='\033[0m'
strip() { sed -E 's/\x1b\[[0-9;]*[GKJ]//g' | grep -vE '^\s*$|Coverage|^ *Start at|^ *Duration|^ *RUN ' ; }
printf "${C}\$ cd PR@87682bc/packages/core && npx vitest run src/extension/extensionManager.test.ts -t 'bounded directory loading'${N}\n"
cd $R/head/packages/core && CI=true FORCE_COLOR=1 npx vitest run src/extension/extensionManager.test.ts -t 'bounded directory loading' --coverage.enabled=false 2>&1 | strip | grep -E '✓|×|Test Files|Tests ' | head -8
printf "\n${C}\$ cp <PR test file> main@71fefc7 && npx vitest run zz-negctl.test.ts -t 'bounded directory loading'${N}   ${D}(main's serial loop)${N}\n"
cd $R/base/packages/core && cp $R/head/packages/core/src/extension/extensionManager.test.ts src/extension/zz-negctl.test.ts
CI=true FORCE_COLOR=1 npx vitest run src/extension/zz-negctl.test.ts -t 'bounded directory loading' --coverage.enabled=false 2>&1 | strip | grep -E '✓|×|AssertionError|Test Files|Tests ' | head -8
rm -f src/extension/zz-negctl.test.ts
printf "  ${D}git status --porcelain (main arm): '%s'${N}\n" "$(git -C $R/base status --porcelain)"
printf "\n${C}Mutation matrix${N} ${D}(each mutant replaces the PR's loop; full extensionManager.test.ts = 187 tests per run)${N}\n"
cd $R/out && for j in mut-m*.json; do node -e "
const r=require('./$j');const k='$j'.replace(/^mut-|\.json\$/g,'');const desc=require('fs').readFileSync('$R/harness/mutants/'+k+'.desc','utf8');
let nw=0,old=0;for(const f of r.testResults)for(const t of f.assertionResults)if(t.status!=='passed'){if(t.ancestorTitles.includes('bounded directory loading'))nw++;else old++}
const ok=r.numFailedTests>0;process.stdout.write('  '+(ok?'\x1b[1;32mKILLED \x1b[0m':'\x1b[1;31mSURVIVED\x1b[0m')+' '+k.padEnd(30)+' new-tests failing '+nw+'/2, other failing '+String(old).padStart(2)+'  \x1b[2m'+desc+'\x1b[0m\n')"; done
printf "  ${Y}m10 is a legitimate alternative design (sliding pool); the first new test pins the batch barrier specifically.${N}\n"
