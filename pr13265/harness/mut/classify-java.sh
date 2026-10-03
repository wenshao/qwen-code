#!/bin/bash
# For each surviving Java mutant: compile the mutated class into its own
# directory, replay the differential candidates with that directory first on
# the classpath, and diff the verdicts against the unmutated head.
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad
WT=$SP/wt-mut
MOD=$WT/packages/sdk-java/managed-agent-server
SRC=$MOD/src/main/java/com/alibaba/qwen/code/managedagent/store/ManagedExtensionRecords.java
D=$SP/rig/diff
OUT=$SP/rig/mut/java; mkdir -p $OUT/cls
CP="$MOD/target/classes:$(cat $SP/rig/cp.txt)"
J=~/Install/jdk21/bin
cp "$SRC" $OUT/original-classify.java
for ID in "$@"; do
  LINE=$(grep "\"id\":\"$ID " $OUT/mutants.jsonl)
  [ -z "$LINE" ] && { echo "$ID: NO_MUTANT"; continue; }
  A=$(node -e '
    const fs=require("fs"); const m=JSON.parse(process.argv[1]); const s=fs.readFileSync(process.argv[2],"utf8");
    const scoped=!/^J(31|32|33|18|19)/.test(m.id); const at=s.indexOf("public static void requireChildRun(JsonNode child)");
    const head=scoped?s.slice(0,at):""; const tail=scoped?s.slice(at):s; const n=tail.split(m.find).length-1;
    if(at<0||n!==1){console.log("BAD_ANCHOR("+n+")");process.exit(0);} fs.writeFileSync(process.argv[2], head+tail.replace(m.find,m.replace)); console.log("ok");' "$LINE" "$SRC")
  if [ "$A" != ok ]; then echo "$ID: $A"; cp $OUT/original-classify.java "$SRC"; continue; fi
  rm -rf $OUT/cls/$ID; mkdir -p $OUT/cls/$ID
  $J/javac --release 21 -parameters -g -nowarn -d $OUT/cls/$ID -cp "$CP" "$SRC" 2>&1 | grep -v "^Note:"
  cp $OUT/original-classify.java "$SRC"
  # keep only the mutated class (and its nested classes) in the override dir
  find $OUT/cls/$ID -name '*.class' ! -name 'ManagedExtensionRecords*.class' -delete
  $J/java -cp "$OUT/cls/$ID:$D/head/cls:$CP" Drive $D/head/cands.jsonl $OUT/$ID.verdicts.tsv
  N=$(node -e '
    const fs=require("fs"); const a=fs.readFileSync(process.argv[1],"utf8").trim().split("\n"); const b=fs.readFileSync(process.argv[2],"utf8").trim().split("\n");
    if(a.length!==b.length){console.log("LENGTH_MISMATCH");process.exit(0);} let n=0; for(let i=0;i<a.length;i++) if(a[i]!==b[i]) n++; console.log(n);' $D/head/java.tsv $OUT/$ID.verdicts.tsv)
  echo "$ID: $N distinguishing candidates"
done
cmp -s "$SRC" $OUT/original-classify.java && echo "source restored" || echo "WARNING source differs"
git -C $WT status --porcelain | grep -v '^??'
