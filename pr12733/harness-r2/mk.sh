#!/bin/bash
set -euo pipefail
SP=$1; H=0c403ae280ab992f34e8f8da9721c921907de538
cd ~/git/qwen-code-pr12733
export GIT_INDEX_FILE=$SP/r2/idx
WF=$(git hash-object -w $SP/r2/probe-pr12733.yml); CE=$(git hash-object -w $SP/census.cjs)
export GIT_AUTHOR_NAME=wenshao GIT_AUTHOR_EMAIL=szujobs@gmail.com GIT_COMMITTER_NAME=wenshao GIT_COMMITTER_EMAIL=szujobs@gmail.com
rm -f $GIT_INDEX_FILE; git read-tree "$H^{tree}"
git update-index --add --cacheinfo 100644,$WF,.github/workflows/probe-pr12733.yml
git update-index --add --cacheinfo 100644,$CE,.github/probe/census.cjs
T=$(git write-tree); C=$(git commit-tree $T -p $H -m "probe: PR #12733 r2 head hosted gates on hosted runners" | tr -d '[:space:]')
git diff --stat $H $C
REFSPEC="${C}:refs/heads/probe/pr12733-r2"; echo "$REFSPEC"
git push https://github.com/wenshao/qwen-code.git "$REFSPEC" 2>&1 | tail -2
