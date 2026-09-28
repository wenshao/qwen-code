#!/bin/bash
# usage: mutate-multi.sh <ID1+ID2+...> [db] [case]
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/83b94b04-5287-4c5b-88f4-0baa57846046/scratchpad
IDS=$1; DB=${2:-mysql}; CASE=$3
WT=$SP/wt-pr
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
IFS='+' read -ra LIST <<< "$IDS"
for ID in "${LIST[@]}"; do
  FILE=$(node -e "console.log(require('$SP/rig/mutants.cjs')['$ID'].file)")
  cp "$WT/$FILE" "$SP/rig/mut-orig-$ID"
  node -e "
const m=require('$SP/rig/mutants.cjs')['$ID'];const fs=require('fs');const f='$WT/'+m.file;
let s=fs.readFileSync(f,'utf8');const n=s.split(m.from).length-1;
if(n!==1){console.error('MUTANT_APPLY_FAIL $ID occurrences='+n);process.exit(2)}
fs.writeFileSync(f,s.replace(m.from,m.to));console.log('applied $ID: '+m.what)" || exit 2
done
(cd $WT && node esbuild.config.js > $SP/logs/rebundle-$IDS.log 2>&1 && node scripts/copy_bundle_assets.js >> $SP/logs/rebundle-$IDS.log 2>&1) || echo "REBUNDLE_FAIL"
EXTRA=""; [ -n "$CASE" ] && EXTRA="-Dqwen.fg6b.case=$CASE"
$SP/rig/it.sh mut-$IDS-$DB $DB hosted-workspace-tools -Dtest=NoUnitTests -Dsurefire.failIfNoSpecifiedTests=false \
  -Dit.test=HostedWorkspaceToolTurnIT#sessionStoreFailuresNeverReplayEffectsOnMySql $EXTRA verify > /dev/null
RC=$?
for ID in "${LIST[@]}"; do
  FILE=$(node -e "console.log(require('$SP/rig/mutants.cjs')['$ID'].file)")
  cp "$SP/rig/mut-orig-$ID" "$WT/$FILE"
done
echo "mutant $IDS gate_exit=$RC"
grep -E "FG6B [a-z-]+:|HOSTED_STORE_FAILURES_OK|Tests run:.*Hosted" $SP/logs/it-mut-$IDS-$DB.log | cut -c1-200
grep -m1 -A3 -E "AssertionError \[ERR_ASSERTION\]|expected: |Expecting" $SP/logs/it-mut-$IDS-$DB.log | cut -c1-300
grep -m1 -o 'FG6B [a-z-]* {' $SP/logs/it-mut-$IDS-$DB.log
