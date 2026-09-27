#!/bin/bash
# Each mutant reverts one R2 fix in source, runs the owning suites, restores.
cd /Users/wenshao/git/qwen-11959-r2
run() { # run <label> <file> <perl-expr> <pkg> <tests...>
  local label=$1 file=$2 expr=$3 pkg=$4; shift 4
  cp $file /tmp/.pr11959-mut-backup 2>/dev/null || cp $file ${file}.bak
  perl -0pi -e "$expr" $file
  if cmp -s $file ${file}.orig 2>/dev/null; then :; fi
  local changed=$(git diff --stat -- $file | tail -1)
  local res=$(cd packages/$pkg && npx vitest run "$@" 2>&1 | grep -E "^ +Tests " | tail -1)
  git checkout -- $file
  printf "%-44s | %-40s | %s\n" "$label" "${changed:-NO CHANGE (mutant not applied)}" "$res"
}
run "M1 drop empty-projection guard" packages/core/src/models/model-catalog-refresh.ts 's/if \(Object\.keys\(next\.models\)\.length === 0\) \{/if (false) {/' core src/models/model-catalog-refresh.test.ts src/models/model-catalog.test.ts
run "M2 drop empty-cache reuse guard" packages/core/src/models/model-catalog-refresh.ts 's/cached\?\.source === url && Object\.keys\(cached\.models\)\.length > 0/cached?.source === url/' core src/models/model-catalog-refresh.test.ts src/models/model-catalog.test.ts
run "M3 drop normalize fixed-point check" packages/core/src/models/model-catalog-refresh.ts 's/if \(normalize\(key\) !== key\) \{/if (false) {/' core src/models/model-catalog-refresh.test.ts src/models/model-catalog.test.ts
run "M4 isEntry accepts false again" packages/core/src/models/model-catalog.ts "s/\\.includes\\(key\\) && value === true/.includes(key) \\&\\& typeof value === 'boolean'/" core src/models/model-catalog.test.ts src/models/model-catalog-refresh.test.ts
run "M5 drop URL from project env exclusions" packages/cli/src/config/shared-env-keys.ts "s/\\n  'QWEN_CODE_MODELS_DEV_URL',//" cli src/config/environment.test.ts src/config/shared-env-keys.test.ts
git status --porcelain | grep -v "^??"; echo "[restored]"
