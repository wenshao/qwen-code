#!/bin/bash
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/4e2fef2a-1851-4d5c-9a46-2dd6291c0a8f/scratchpad
WT=$HOME/git/pr12808-mut; M=$WT/packages/sdk-java/managed-agent-server; T=src/test/java/com/alibaba/qwen/code/managedagent
SPEC=$M/src/main/resources/openapi/managed-agent-public-api.openapi.json
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
typo() { python3 - "$SPEC" "$1" <<'PY'
import json,sys
p,target=sys.argv[1],sys.argv[2]
s=json.load(open(p))
prop={'reach':('WebShellAdmission','sessionId'),'unreach':('PublicCommandOperation','session_id')}[target]
node=s['components']['schemas'][prop[0]]['properties'][prop[1]]
assert 'format' in node
s['components']['schemas'][prop[0]]['properties'][prop[1]]={('frmat' if k=='format' else k):v for k,v in node.items()}
json.dump(s,open(p,'w'),indent=2,ensure_ascii=False)
PY
}
arm() { cd $WT && git restore --source=HEAD --worktree -- packages/sdk-java
  case $1 in
    head) ;;
    oldfactory) python3 - "$M/$T/OpenApiContract.java" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='''    private final JsonSchemaFactory factory = JsonSchemaFactory.getInstance(
            VersionFlag.V202012, builder -> builder.metaSchema(JsonMetaSchema
                    .builder(JsonMetaSchema.getV202012())
                    .unknownKeywordFactory((keyword, context) ->
                            new AnnotationKeyword(keyword))
                    .build()));'''
assert s.count(old)==1
open(p,'w').write(s.replace(old,'''    private final JsonSchemaFactory factory =
            JsonSchemaFactory.getInstance(VersionFlag.V202012);'''))
PY
    ;;
    cand) cp $S/r3/cand-ContractTest.java $M/$T/ManagedAgentApiContractTest.java ;;
  esac
}
for t in reach unreach; do for a in head oldfactory cand; do
  arm $a; typo $t
  log=$S/r3/logs/f4-$t-$a.log
  (cd $M && $S/mvn21 test -Dtest=ManagedAgentApiContractTest -Dcheckstyle.skip > $log 2>&1)
  res=$(grep -E "Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$" $log | tail -1 | sed 's/\[[A-Z]*\] //')
  echo "$t | $a | $res | Unknown-keyword WARNs=$(grep -c 'Unknown keyword' $log) (frmat: $(grep -c 'Unknown keyword frmat' $log)) | $(grep -o '/components/schemas/[A-Za-z]*/properties/[A-Za-z_]*/frmat' $log | head -1)"
done; done
cd $WT && git restore --source=HEAD --worktree -- packages/sdk-java && git status --porcelain | head -2
