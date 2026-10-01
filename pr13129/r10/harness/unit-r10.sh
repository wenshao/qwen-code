#!/bin/bash
set -u
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
W=/Users/wenshao/pr13129-rig/wt; O=/Users/wenshao/pr13129-rig/out
cd $W && echo "head=$(git rev-parse --short HEAD) mergebase=728c13de21" && git diff --name-only 728c13de219885de6a3e93223460c3ec8a8f690d HEAD | /usr/bin/grep -E "\.test\.ts$" > $O/r10-changed-tests.txt
CLI=$(/usr/bin/grep "^packages/cli/" $O/r10-changed-tests.txt | sed 's#packages/cli/##' | tr '\n' ' ')
CORE=$(/usr/bin/grep "^packages/core/" $O/r10-changed-tests.txt | sed 's#packages/core/##' | /usr/bin/grep -v "core/client.test.ts" | tr '\n' ' ')
echo "files: cli $(echo $CLI | wc -w) core $(echo $CORE | wc -w); load $(sysctl -n vm.loadavg)"
cd $W/packages/cli && npx vitest run $CLI --reporter=verbose > $O/r10-unit-cli.log 2>&1; echo "cli exit=$?"
cd $W/packages/core && npx vitest run $CORE --reporter=dot > $O/r10-unit-core.log 2>&1; echo "core exit=$?"
for f in r10-unit-cli r10-unit-core; do echo "== $f: $(/usr/bin/grep -E '^ +Tests ' $O/$f.log)"; done
/usr/bin/grep -E '^ +×' $O/r10-unit-cli.log | sed 's/^ *× //' | cut -c1-200
mut() { # name file perl-expr testfiles...
  local n=$1 f=$2 e=$3; shift 3
  cd $W && perl -0pi -e "$e" "$f" && echo "== mutation $n: $(git diff --stat -- $f | tail -1)"
  cd $W/packages/cli && npx vitest run "$@" --reporter=verbose 2>&1 | /usr/bin/grep -E '^ +×|^ +Tests ' | sed 's/^ *//' | cut -c1-200
  cd $W && git checkout HEAD -- "$f" && git status --short | wc -l | xargs echo "restored, dirty files:"
}
mut M1-buffer-never packages/cli/src/serve/hosted-harness-model.ts 's/\? undefined\n      : input\.textDeltas;/? input.textDeltas\n      : input.textDeltas;/' src/serve/hosted-harness-model.test.ts src/serve/hosted-harness-session.test.ts
mut M2-takeover-flags-for-hooks packages/cli/src/serve/hosted-harness-session.ts 's/const takeover =\n        !session\.hooks &&\n/const takeover =\n/' src/serve/hosted-harness-session.test.ts
mut M3-runtime-routes-unguarded packages/cli/src/serve/hosted-harness-session.ts 's/    if \(session\.hooks\) return error\(res, 409, .hosted_hook_recovery_required.\);\n//g' src/serve/hosted-harness-session.test.ts
