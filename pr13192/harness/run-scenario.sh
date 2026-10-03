#!/bin/bash
# usage: run-scenario.sh <name> <phase1-arm> <phase2-arm> <TZ> <order>
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b5c403f1-14a1-452a-91d4-be31986042f6/scratchpad
NAME=$1; A1=$2; A2=$3; ZONE=$4; ORDER=$5
OUT=$S/upgrade/$NAME; rm -rf $OUT; mkdir -p $OUT
export JAVA_HOME=$HOME/Install/jdk21 PATH=$HOME/Install/jdk21/bin:$PATH
COMMON=(-B -ntp -o -Dmaven.repo.local=$S/m2 -Pmysql-integration
  "-Dmysql.url=jdbc:mysql://127.0.0.1:33192/upg_admin?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false"
  -Dmysql.user=root -Dmysql.password=pr13192pw -Dprobe.schema=upg_$NAME -Dprobe.state=$OUT/state.json
  -Dprobe.out=$OUT/phase2.json "-Dprobe.order=$ORDER" -Dfailsafe.failIfNoSpecifiedTests=false)
run() { # arm phase
  cd ~/git/qwen-code-pr13192-upg-$1/packages/sdk-java/managed-agent-server
  rm -rf target/failsafe-reports
  TZ=$ZONE mvn "${COMMON[@]}" "-Dit.test=UpgradeProbeMySqlIT#$2" failsafe:integration-test failsafe:verify > $OUT/$2-$1.log 2>&1
  echo "$2 ($1) rc=$? at $(date +%T)" >> $OUT/meta.txt
}
echo "scenario=$NAME phase1=$A1 phase2=$A2 TZ=$ZONE order=$ORDER start=$(date +%T)" > $OUT/meta.txt
run $A1 phase1
run $A2 phase2
cat $OUT/meta.txt
node -e 'const j=require(process.argv[1]); console.log("phase1", JSON.stringify(j.phase1)); for (const s of j.steps) console.log(" ", s.op.padEnd(9), s.result.padEnd(8), (s.message||s.grantState||"").padEnd(42), "pub-1:", s.pub1State, s.pub1ExpiresAt===null?"null":((s.pub1ExpiresAt-s.sqlEpochNow)/1000).toFixed(1)+"s vs SQL now")' $OUT/phase2.json 2>&1
