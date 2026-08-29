#!/bin/zsh
# Mutation matrix: each mutant flips one load-bearing detail of the fix.
# A surviving mutant means the PR's tests do not actually pin that detail.
set -u
TREE=/Users/wenshao/git/qwen-code-x3/tmp/pr10083/tree
SRC=$TREE/packages/core/src/tools/send-message.ts
OUT=/Users/wenshao/git/qwen-code-x3/tmp/pr10083/mutation
mkdir -p $OUT
cp $SRC $OUT/send-message.orig.ts

run_suite () {
  ( cd $TREE/packages/core && npx vitest run src/tools/send-message.test.ts \
      --reporter=dot --coverage.enabled=false 2>&1 )
}

mutant () {
  local id=$1; shift
  local desc=$1; shift
  cp $OUT/send-message.orig.ts $SRC
  python3 - "$SRC" "$@" <<'PY'
import sys
p=sys.argv[1]; old=sys.argv[2]; new=sys.argv[3]
s=open(p).read()
assert s.count(old)==1, f"anchor count {s.count(old)} for {old!r}"
open(p,'w').write(s.replace(old,new))
PY
  if [[ $? -ne 0 ]]; then echo "$id ANCHOR-FAIL"; return; fi
  local log=$OUT/$id.log
  run_suite > $log 2>&1
  if grep -qE "Tests .*failed|FAIL " $log; then
    local nfail=$(grep -oE "[0-9]+ failed" $log | head -1)
    echo "$id KILLED ($nfail) — $desc"
  else
    echo "$id SURVIVED — $desc"
  fi
}

mutant M1 "validation hook never rejects the both-fields call" \
  'if (params.to && params.task_id) {' 'if (false && params.to && params.task_id) {'

mutant M2 "validation rejects only when task_id is absent (inverted guard)" \
  'if (params.to && params.task_id) {' 'if (params.to && !params.task_id) {'

mutant M3 "teammate hint text is never appended to llmContent" \
  'const teammateHint = teammate' 'const teammateHint = false'

mutant M4 "returnDisplay keeps the generic wording even on a roster match" \
  'returnDisplay: teammate' 'returnDisplay: false'

mutant M5 "hint echoes the raw task_id instead of the normalized roster name" \
  'teammate "${teammate.name}"? If so, use \`to: "${teammate.name}"\`' 'teammate "${this.params.task_id}"? If so, use \`to: "${this.params.task_id}"\`'

mutant M6 "null-team guard dropped (getTeamManager() is dereferenced unconditionally)" \
  'const teammate = teamManager
          ? findMemberByName(
              teamManager.getTeamFile().members,
              this.params.task_id,
            )
          : undefined;' 'const teammate = findMemberByName(
              teamManager!.getTeamFile().members,
              this.params.task_id,
            );'

cp $OUT/send-message.orig.ts $SRC
echo "--- restored original ---"
diff -q $SRC $OUT/send-message.orig.ts && echo "source restored OK"
