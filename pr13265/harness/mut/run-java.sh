#!/bin/bash
# Applies each Java mutant in wt-mut: javac the one class into target/classes,
# run the two contract tests offline with surefire, restore and recompile.
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad
WT=$SP/wt-mut
MOD=$WT/packages/sdk-java/managed-agent-server
SRC=$MOD/src/main/java/com/alibaba/qwen/code/managedagent/store/ManagedExtensionRecords.java
CLS=$MOD/target/classes/com/alibaba/qwen/code/managedagent/store/ManagedExtensionRecords.class
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:~/Install/maven/bin:$PATH
CP="$MOD/target/classes:$(cat $SP/rig/cp.txt)"
OUT=$SP/rig/mut/java; mkdir -p $OUT
A=(--batch-mode --no-transfer-progress -o -q -s $SP/m2settings.xml -Dmaven.repo.local=$SP/m2repo)
compile() { javac --release 21 -parameters -g -nowarn -d $MOD/target/classes -cp "$CP" "$SRC" 2>&1 | grep -v "^Note:" ; }
compile; BASE_SHA=$(shasum -a 256 $CLS | cut -c1-64); echo "baseline class sha ${BASE_SHA:0:16}"
runtests() {
  rm -rf $MOD/target/surefire-reports
  (cd $MOD && mvn "${A[@]}" surefire:test -Dtest='ManagedChildRunRecordContractTest,ManagedExtensionProjectionContractTest' -Dsurefire.failIfNoSpecifiedTests=false > $OUT/last.log 2>&1)
  node -e '
    const fs=require("fs"); const d=process.argv[1]; let t=0,f=0,e=0; const msgs=[];
    for (const x of fs.readdirSync(d).filter(n=>n.endsWith(".xml"))) { const s=fs.readFileSync(d+"/"+x,"utf8");
      const m=s.match(/tests="(\d+)"[^>]*failures="(\d+)"|failures="(\d+)"[^>]*tests="(\d+)"/);
      t+=Number((s.match(/ tests="(\d+)"/)||[])[1]||0); f+=Number((s.match(/ failures="(\d+)"/)||[])[1]||0); e+=Number((s.match(/ errors="(\d+)"/)||[])[1]||0);
      for (const mm of s.matchAll(/<(failure|error) message="([^"]{0,140})/g)) msgs.push(mm[2]); }
    console.log(`tests=${t} failures=${f} errors=${e} ${msgs.slice(0,2).join(" | ")}`);' $MOD/target/surefire-reports 2>/dev/null || echo "tests=0 NO_REPORTS"
}
echo "baseline: $(runtests)"
node --input-type=module -e "const { MUTANTS } = await import('$SP/rig/mut/java-mutants.mjs'); for (const [id, find, replace] of MUTANTS) console.log(JSON.stringify({ id, find, replace }));" > $OUT/mutants.jsonl
cp "$SRC" $OUT/original.java
while IFS= read -r line; do
  ID=$(node -e 'console.log(JSON.parse(process.argv[1]).id)' "$line")
  if [ -n "$ONLY" ] && [[ "$ID" != $ONLY* ]]; then continue; fi
  APPLIED=$(node -e '
    const fs=require("fs"); const m=JSON.parse(process.argv[1]); const s=fs.readFileSync(process.argv[2],"utf8");
    const at=s.indexOf("public static void requireChildRun(JsonNode child)"); const head=m.id.match(/^J(31|32|33)/)?"":s.slice(0,at); const tail=m.id.match(/^J(31|32|33)/)?s:s.slice(at); const n=tail.split(m.find).length-1; if(at<0||n!==1){console.log("BAD_ANCHOR("+n+")");process.exit(0);} fs.writeFileSync(process.argv[2], head+tail.replace(m.find,m.replace)); console.log("ok");' "$line" "$SRC")
  if [ "$APPLIED" != ok ]; then echo "$ID: $APPLIED"; cp $OUT/original.java "$SRC"; continue; fi
  CERR=$(compile)
  if [ -n "$CERR" ]; then echo "$ID: COMPILE_ERROR $(echo "$CERR" | head -2 | tr '\n' ' ')"; cp $OUT/original.java "$SRC"; compile; continue; fi
  R=$(runtests)
  cp $OUT/original.java "$SRC"
  if echo "$R" | grep -qE "failures=[1-9]|errors=[1-9]"; then S=KILLED; elif echo "$R" | grep -q "tests=0"; then S=NO_RUN; else S=SURVIVED; fi
  echo "$ID: $S ($R)"
done < $OUT/mutants.jsonl
compile
NOW_SHA=$(shasum -a 256 $CLS | cut -c1-64)
[ "$NOW_SHA" = "$BASE_SHA" ] && [ ${#NOW_SHA} -eq 64 ] && echo "restored class sha matches baseline" || echo "WARNING class sha differs after restore"
git -C $WT status --porcelain | grep -v '^??' | head
