#!/bin/bash
# usage: mutate.sh <mutant-id> [db=mysql]
# Applies one mutant in wt-pr, rebundles, runs the PR's own FG6b gate, restores the file.
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/83b94b04-5287-4c5b-88f4-0baa57846046/scratchpad
ID=$1; DB=${2:-mysql}
WT=$SP/wt-pr
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
FILE=$(node -e "console.log(require('$SP/rig/mutants.cjs')['$ID'].file)")
cp "$WT/$FILE" "$SP/rig/mut-orig-$ID"
node -e "
const m=require('$SP/rig/mutants.cjs')['$ID'];const fs=require('fs');const f='$WT/'+m.file;
let s=fs.readFileSync(f,'utf8');const n=s.split(m.from).length-1;
if(n!==1){console.error('MUTANT_APPLY_FAIL occurrences='+n);process.exit(2)}
fs.writeFileSync(f,s.replace(m.from,m.to));console.log('applied $ID: '+m.what)" || exit 2
(cd $WT && node esbuild.config.js > $SP/logs/rebundle-$ID.log 2>&1 && node scripts/copy_bundle_assets.js >> $SP/logs/rebundle-$ID.log 2>&1) || { echo "REBUNDLE_FAIL"; cp "$SP/rig/mut-orig-$ID" "$WT/$FILE"; exit 3; }
$SP/rig/it.sh mut-$ID-$DB $DB hosted-workspace-tools -Dtest=NoUnitTests -Dsurefire.failIfNoSpecifiedTests=false \
  -Dit.test=HostedWorkspaceToolTurnIT#sessionStoreFailuresNeverReplayEffectsOnMySql verify > /dev/null
RC=$?
cp "$SP/rig/mut-orig-$ID" "$WT/$FILE"
echo "mutant $ID gate_exit=$RC"
grep -E "FG6B [a-z-]+:|HOSTED_STORE_FAILURES_OK|Tests run:.*Hosted" $SP/logs/it-mut-$ID-$DB.log | cut -c1-200
# first failure detail
grep -m1 -A4 -E "AssertionError|expected|Expecting|FG6B [a-z-]+ \{" $SP/logs/it-mut-$ID-$DB.log | cut -c1-400
exit 0
