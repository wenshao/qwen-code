#!/bin/bash
# Real-run demo for checker mutant C3: J5 makes one O4 gate case fail; -Dmaven.test.failure.ignore=true lets Maven succeed.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9d84bca0-c4ea-4895-80e3-553468b6983a/scratchpad
W=/Users/wenshao/git/qwen-code-pr13090-mut; N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
F=$W/packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ToolPublicationCollector.java
cp $F $S/mut/collector.orig
$N -e 'const fs=require("fs");const f=process.argv[1];const t=fs.readFileSync(f,"utf8");const a="                    defer(claim);\n                    return false;";if(t.split(a).length!==2)process.exit(3);fs.writeFileSync(f,t.replace(a,"                    return false;"))' $F || { echo anchor; exit 3; }
trap 'cp $S/mut/collector.orig $F' EXIT
M2=m2b $S/rig/o4gate.sh $W demo-c3-ignore o4-mysql-gates -Dmaven.test.failure.ignore=true
cp $W/scripts/check-failsafe-reports.js $S/mut/checker-c3.mjs
$N -e 'const fs=require("fs");const f=process.argv[1];const t=fs.readFileSync(f,"utf8");const a="[\x27skipped\x27, \x27failure\x27, \x27error\x27].some";if(t.split(a).length!==2)process.exit(3);fs.writeFileSync(f,t.replace(a,"[\x27skipped\x27].some"))' $S/mut/checker-c3.mjs || { echo anchor2; exit 3; }
cd $W; echo "== checker with C3 mutation on the same reports:"; $N $S/mut/checker-c3.mjs o4-mysql packages/sdk-java/managed-agent-server; echo "C3 checker exit=$?"
grep -c "<failure" packages/sdk-java/managed-agent-server/target/failsafe-reports/TEST-*.xml
